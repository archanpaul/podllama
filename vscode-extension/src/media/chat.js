(function () {
    const vscode = acquireVsCodeApi();

    const messagesContainer = document.getElementById('chat-messages');
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const modelSelect = document.getElementById('model-select');
    const historyBtn = document.getElementById('history-btn');
    const newChatBtn = document.getElementById('new-chat-btn');
    const historyDrawer = document.getElementById('history-drawer');
    const historyList = document.getElementById('history-list');

    let currentConversation = null;

    // Handle messages sent from Extension Host
    window.addEventListener('message', event => {
        const message = event.data;

        switch (message.type) {
            case 'initSession':
                currentConversation = message.session;
                updateModelSelect(message.models, message.selectedModel);
                renderConversation(currentConversation);
                break;
            case 'updateModels':
                updateModelSelect(message.models, message.selectedModel);
                break;
            case 'updateHistoryList':
                renderHistoryList(message.conversations);
                break;
            case 'streamToken':
                if (message.appendInput && promptInput) {
                    promptInput.value += message.appendInput;
                    vscode.setState({ text: promptInput.value });
                    promptInput.scrollTop = promptInput.scrollHeight;
                } else {
                    appendStreamToken(message.text, message.thinking);
                }
                break;
            case 'streamEnd':
                finalizeStreamResponse();
                break;
        }
    });

    function updateModelSelect(models, selectedModel) {
        if (!modelSelect) return;
        modelSelect.innerHTML = '';

        // Filter model list to only include IDs starting with 'podllama-'
        const filteredModels = (models || []).filter(m => m.id && m.id.startsWith('podllama-'));

        if (filteredModels.length === 0) {
            const opt = document.createElement('option');
            opt.value = 'podllama-chat';
            opt.textContent = 'podllama-chat';
            modelSelect.appendChild(opt);
            return;
        }

        filteredModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.id;
            if (m.id === selectedModel) {
                opt.selected = true;
            }
            modelSelect.appendChild(opt);
        });
    }

    function renderConversation(conv) {
        if (!messagesContainer) return;
        messagesContainer.innerHTML = '';

        const titleInput = document.getElementById('chat-title-input');
        if (titleInput && conv) {
            titleInput.value = conv.title || 'Untitled Chat';
        }

        if (!conv || !conv.messages || conv.messages.length === 0) {
            messagesContainer.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); margin-top: 40px;">
                    <p style="font-size: 14px; font-weight: 500;">Welcome to PodLlama Code</p>
                    <p style="font-size: 12px; margin-top: 6px;">Ask a question or request code refactoring.</p>
                </div>
            `;
            return;
        }

        conv.messages.forEach(msg => {
            appendMessageTurn(msg.role, msg.content, msg.thinking);
        });

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function appendMessageTurn(role, content, thinking) {
        const turnDiv = document.createElement('div');
        turnDiv.className = `message-turn ${role}`;

        if (role === 'assistant') {
            let html = '';
            if (thinking) {
                html += `
                    <details class="think-card" open>
                        <summary class="think-summary">Thought Process</summary>
                        <div class="think-content">${escapeHtml(thinking)}</div>
                    </details>
                `;
            }
            html += `<div class="message-content">${formatMarkdown(content)}</div>`;
            turnDiv.innerHTML = html;
        } else {
            turnDiv.innerHTML = `<div class="message-content">${formatMarkdown(content)}</div>`;
        }

        messagesContainer.appendChild(turnDiv);
        attachCodeBlockActions(turnDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    let activeStreamTurn = null;

    function appendStreamToken(text, thinking) {
        if (!activeStreamTurn) {
            activeStreamTurn = document.createElement('div');
            activeStreamTurn.className = 'message-turn assistant';
            activeStreamTurn.innerHTML = `
                <div id="stream-thinking-placeholder" style="color: var(--text-muted, #888888); font-style: italic; margin-bottom: 8px;">Thinking...</div>
                <details class="think-card" id="stream-think-card" style="display: none;">
                    <summary class="think-summary">Thinking...</summary>
                    <div class="think-content" id="stream-think-content"></div>
                </details>
                <div class="message-content" id="stream-message-content"></div>
            `;
            messagesContainer.appendChild(activeStreamTurn);
        }

        const placeholder = activeStreamTurn.querySelector('#stream-thinking-placeholder');

        if (thinking !== undefined && thinking !== null && thinking !== '') {
            if (placeholder) {
                placeholder.style.display = 'none';
            }
            const thinkCard = activeStreamTurn.querySelector('#stream-think-card');
            const thinkContent = activeStreamTurn.querySelector('#stream-think-content');
            if (thinkCard && thinkContent) {
                thinkCard.style.display = 'block';
                thinkContent.textContent += thinking;
            }
        }

        if (text !== undefined && text !== null && text !== '') {
            if (placeholder) {
                placeholder.style.display = 'none';
            }
            const msgContent = activeStreamTurn.querySelector('#stream-message-content');
            if (msgContent) {
                msgContent.dataset.raw = (msgContent.dataset.raw || '') + text;
                try {
                    const formatted = formatMarkdown(msgContent.dataset.raw);
                    msgContent.innerHTML = formatted || escapeHtml(msgContent.dataset.raw);
                } catch (e) {
                    console.error('Streaming rendering exception caught:', e);
                    msgContent.textContent = msgContent.dataset.raw;
                }
                attachCodeBlockActions(msgContent);
            }
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function finalizeStreamResponse() {
        if (activeStreamTurn) {
            const placeholder = activeStreamTurn.querySelector('#stream-thinking-placeholder');
            if (placeholder) {
                placeholder.remove();
            }
            // Apply syntax highlight once token streaming has completely finalized
            attachCodeBlockActions(activeStreamTurn, true);
        }
        activeStreamTurn = null;
        setGeneratingState(false);
    }

    function setGeneratingState(generating) {
        isGenerating = generating;
        if (generating) {
            sendBtn.innerHTML = '<i class="fa-solid fa-circle-stop" style="font-size: 22px;"></i>';
            sendBtn.style.color = 'var(--vscode-errorForeground, #f48771)';
        } else {
            sendBtn.innerHTML = '<i class="fa-solid fa-circle-play" style="font-size: 22px;"></i>';
            sendBtn.style.color = 'var(--accent)';
        }
    }

    function attachCodeBlockActions(container, forceHighlight = false) {
        const pres = container.querySelectorAll('pre');
        pres.forEach(pre => {
            if (pre.querySelector('.code-actions')) return;

            // Apply syntax coloring highlight only if finalized or forced
            const codeEl = pre.querySelector('code');
            if (codeEl && typeof hljs !== 'undefined' && forceHighlight) {
                try {
                    hljs.highlightElement(codeEl);
                } catch (e) {
                    console.error('Highlight error:', e);
                }
            }

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'code-actions';

            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.onclick = () => {
                const code = pre.querySelector('code')?.innerText || '';
                navigator.clipboard.writeText(code);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => copyBtn.textContent = 'Copy', 1500);
            };

            const patchBtn = document.createElement('button');
            patchBtn.className = 'patch-btn';
            patchBtn.textContent = 'Apply to Editor';
            patchBtn.onclick = () => {
                const code = pre.querySelector('code')?.innerText || '';
                vscode.postMessage({ command: 'applyPatch', code });
            };

            actionsDiv.appendChild(copyBtn);
            actionsDiv.appendChild(patchBtn);
            pre.appendChild(actionsDiv);
        });
    }

    // Configure marked to use highlight.js for syntax coloring safely
    if (typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
        marked.setOptions({
            highlight: function (code, lang) {
                try {
                    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                    return hljs.highlight(code, { language }).value;
                } catch (e) {
                    return code; // Fallback plain text on syntax errors
                }
            },
            langPrefix: 'hljs language-'
        });
    }

    function formatMarkdown(text) {
        if (!text) return '';

        try {
            // Render markdown using marked.js if loaded
            if (typeof marked !== 'undefined' && marked.parse) {
                let processedText = text;
                const matches = text.match(/```/g);
                const backtickCount = matches ? matches.length : 0;
                if (backtickCount % 2 !== 0) {
                    processedText += '\n```';
                }
                try {
                    const parsed = marked.parse(processedText);
                    if (parsed) return parsed;
                } catch (innerErr) {
                    // Ignore and fallback
                }
            }
        } catch (e) {
            console.error('Error rendering markdown with marked.js:', e);
        }

        return fallbackMarkdown(text);
    }

    function fallbackMarkdown(text) {
        // Fallback basic parsing
        let formatted = escapeHtml(text);
        formatted = formatted.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code class="language-${lang}">${code}</code></pre>`;
        });
        formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
        formatted = formatted.replace(/\$\$([\s\S]*?)\$\$/g, '<div class="latex-display">$1</div>');
        formatted = formatted.replace(/\\\(([\s\S]*?)\\\)/g, '<span class="latex-inline">$1</span>');
        return formatted;
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    let isGenerating = false;

    // UI Event Listeners
    if (sendBtn && promptInput) {
        sendBtn.addEventListener('click', () => {
            if (isGenerating) {
                // Trigger Stop Action
                vscode.postMessage({ command: 'stopGeneration' });
                setGeneratingState(false);
                return;
            }

            const prompt = promptInput.value.trim();
            if (!prompt) return;

            const selectedModel = modelSelect ? modelSelect.value : 'podllama-chat';

            appendMessageTurn('user', prompt);
            setGeneratingState(true);

            vscode.postMessage({
                command: 'sendMessage',
                prompt,
                model: selectedModel
            });

            promptInput.value = '';
            vscode.setState({ text: '' });
        });

        // Restore saved textarea state on load
        const previousState = vscode.getState();
        if (previousState && previousState.text) {
            promptInput.value = previousState.text;
        }

        // Save textarea content on keypress / input
        promptInput.addEventListener('input', () => {
            vscode.setState({ text: promptInput.value });
        });

        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendBtn.click();
            }
        });
    }

    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            if (historyDrawer) {
                historyDrawer.classList.remove('open');
            }
            vscode.postMessage({ command: 'newConversation' });
        });
    }

    const chatTitleInput = document.getElementById('chat-title-input');
    if (chatTitleInput) {
        const saveTitleRename = () => {
            const title = chatTitleInput.value.trim();
            if (title && currentConversation && title !== currentConversation.title) {
                currentConversation.title = title;
                vscode.postMessage({ command: 'renameConversation', title });
            }
        };

        chatTitleInput.addEventListener('blur', saveTitleRename);
        chatTitleInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                chatTitleInput.blur();
            }
        });
    }

    const addContextBtn = document.getElementById('add-context-btn');
    if (addContextBtn) {
        addContextBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'addContextAttachment' });
        });
    }

    if (historyBtn && historyDrawer) {
        historyBtn.addEventListener('click', () => {
            historyDrawer.classList.toggle('open');
            if (historyDrawer.classList.contains('open')) {
                vscode.postMessage({ command: 'getHistoryList' });
            }
        });
    }

    function renderHistoryList(conversations) {
        if (!historyList) return;
        historyList.innerHTML = '';

        if (!conversations || conversations.length === 0) {
            historyList.innerHTML = '<li style="color: var(--text-muted); font-size: 12px;">No past conversations</li>';
            return;
        }

        conversations.forEach(c => {
            const li = document.createElement('li');
            li.className = 'history-item';
            li.innerHTML = `
                <span>${escapeHtml(c.title || 'Untitled Chat')}</span>
                <button class="icon-btn delete-conv-btn" data-id="${c.id}">✕</button>
            `;
            li.onclick = (e) => {
                if (e.target.classList.contains('delete-conv-btn')) {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'deleteConversation', id: c.id });
                } else {
                    vscode.postMessage({ command: 'selectConversation', id: c.id });
                    historyDrawer.classList.remove('open');
                }
            };
            historyList.appendChild(li);
        });
    }
})();
