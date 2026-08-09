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

        turnDiv.innerHTML = `<div class="message-content">${formatMarkdown(content)}</div>`;

        messagesContainer.appendChild(turnDiv);
        attachCodeBlockActions(turnDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    let activeStreamTurn = null;
    let activeStreamContentElement = null;
    let streamDataBuffer = ''; // Raw streamed data accumulation buffer
    let viewBuffer = '';       // Rendered UI content buffer
    let streamRenderScheduled = false;
    let uiTokenCount = 0;

    function renderStream() {
        if (!activeStreamContentElement) {
            console.warn('[PodLlama UI] renderStream skipped: activeStreamContentElement is null');
            return;
        }

        // Update viewBuffer with current raw streamed data directly via DOM reference
        viewBuffer = streamDataBuffer;
        activeStreamContentElement.style.whiteSpace = 'pre-wrap';
        activeStreamContentElement.textContent = viewBuffer;

        console.log(`[PodLlama UI] Render frame: buffer len=${streamDataBuffer.length}, tail snippet="${viewBuffer.slice(-25).replace(/\n/g, '\\n')}"`);

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        streamRenderScheduled = false;
    }

    function appendStreamToken(text, thinking) {
        uiTokenCount++;
        if (!activeStreamTurn || !activeStreamContentElement) {
            console.log('[PodLlama UI] Creating new assistant message turn DOM element');
            activeStreamTurn = document.createElement('div');
            activeStreamTurn.className = 'message-turn assistant';
            
            activeStreamContentElement = document.createElement('div');
            activeStreamContentElement.className = 'message-content';
            
            activeStreamTurn.appendChild(activeStreamContentElement);
            messagesContainer.appendChild(activeStreamTurn);

            streamDataBuffer = '';
            viewBuffer = '';
            uiTokenCount = 1;
        }

        if (text !== undefined && text !== null && text !== '') {
            streamDataBuffer += text;
            console.log(`[PodLlama UI] Token #${uiTokenCount}: +${text.length} chars (total len=${streamDataBuffer.length}) -> snippet: ${JSON.stringify(text)}`);
            
            if (!streamRenderScheduled) {
                streamRenderScheduled = true;
                requestAnimationFrame(renderStream);
            }
        }
    }

    function finalizeStreamResponse() {
        console.log(`[PodLlama UI] finalizeStreamResponse called: total tokens=${uiTokenCount}, raw buffer len=${streamDataBuffer.length}`);
        if (activeStreamTurn && activeStreamContentElement) {
            if (streamDataBuffer) {
                activeStreamContentElement.style.whiteSpace = '';
                try {
                    const html = formatMarkdown(streamDataBuffer, false);
                    if (html && html.trim().length > 0) {
                        viewBuffer = html;
                        activeStreamContentElement.innerHTML = viewBuffer;
                        console.log(`[PodLlama UI] Final Markdown parse succeeded: HTML len=${html.length}`);
                    } else {
                        viewBuffer = fallbackMarkdown(streamDataBuffer);
                        activeStreamContentElement.innerHTML = viewBuffer;
                        console.warn('[PodLlama UI] Final Markdown parse returned empty string; used fallbackMarkdown.');
                    }
                } catch (e) {
                    console.error('[PodLlama UI] Error in final formatMarkdown:', e);
                    viewBuffer = fallbackMarkdown(streamDataBuffer);
                    activeStreamContentElement.innerHTML = viewBuffer;
                }
                attachCodeBlockActions(activeStreamContentElement, false);
            }
        }
        activeStreamTurn = null;
        activeStreamContentElement = null;
        streamDataBuffer = '';
        viewBuffer = '';
        uiTokenCount = 0;
        setGeneratingState(false);
    }

    function setGeneratingState(generating) {
        isGenerating = generating;
        if (generating) {
            sendBtn.innerHTML = '<i class="fa-solid fa-circle-stop" style="font-size: 14px;"></i>';
            sendBtn.style.color = 'var(--vscode-errorForeground, #f48771)';
        } else {
            sendBtn.innerHTML = '<i class="fa-solid fa-circle-play" style="font-size: 14px;"></i>';
            sendBtn.style.color = 'var(--accent)';
        }
    }

    function attachCodeBlockActions(container, isStreaming = false) {
        const pres = container.querySelectorAll('pre');
        pres.forEach(pre => {
            if (pre.querySelector('.code-actions')) return;

            // Apply syntax coloring highlight ONLY if not streaming
            const codeEl = pre.querySelector('code');
            if (!isStreaming && codeEl && typeof hljs !== 'undefined') {
                hljs.highlightElement(codeEl);
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

    // Configure marked to not use highlight.js internally
    // We apply it manually in attachCodeBlockActions to control performance
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            langPrefix: 'language-'
        });
    }

    function formatMarkdown(text, isStreaming = false) {
        if (!text) return '';
        
        try {
            if (typeof marked !== 'undefined' && marked.parse) {
                let processedText = text;
                
                // 1. Auto-close triple-backtick fence markers (```)
                const fences = (processedText.match(/```/g) || []).length;
                if (fences % 2 !== 0) {
                    processedText += '\n```';
                }

                // 2. Auto-close tilde code fences (~~~)
                const tildes = (processedText.match(/~~~/g) || []).length;
                if (tildes % 2 !== 0) {
                    processedText += '\n~~~';
                }

                // 3. Auto-close single backticks for inline code (`code`)
                const textWithoutFences = processedText.replace(/```[\s\S]*?(```|$)/g, '').replace(/~~~[\s\S]*?(~~~|$)/g, '');
                const singleBackticks = (textWithoutFences.match(/`/g) || []).length;
                if (singleBackticks % 2 !== 0) {
                    processedText += '`';
                }

                // 4. Auto-close explicit HTML <code> and <pre> tags
                const codeStarts = (processedText.match(/<code[\s>]/gi) || []).length;
                const codeEnds = (processedText.match(/<\/code>/gi) || []).length;
                if (codeStarts > codeEnds) {
                    processedText += '</code>';
                }

                const preStarts = (processedText.match(/<pre[\s>]/gi) || []).length;
                const preEnds = (processedText.match(/<\/pre>/gi) || []).length;
                if (preStarts > preEnds) {
                    processedText += '</pre>';
                }

                // 5. Prevent unclosed HTML comments (<!--) from hiding subsequent text in innerHTML
                const commentStarts = (processedText.match(/<!--/g) || []).length;
                const commentEnds = (processedText.match(/-->/g) || []).length;
                if (commentStarts > commentEnds) {
                    processedText += '-->';
                }

                // 6. Escape raw script/style/textarea/svg/iframe tags so browser DOM doesn't hide inner content
                processedText = processedText.replace(/<(script|style|textarea|svg|iframe)([\s>])/gi, '&lt;$1$2');
                processedText = processedText.replace(/<\/(script|style|textarea|svg|iframe)>/gi, '&lt;/$1&gt;');

                const parsed = marked.parse(processedText);
                if (typeof parsed === 'string' && parsed.trim().length > 0) {
                    return parsed;
                }

                if (isStreaming) {
                    throw new Error('Markdown parse returned empty result during streaming');
                }
            }
        } catch (e) {
            if (isStreaming) {
                throw e;
            }
            console.warn('[PodLlama] marked.parse failed, using fallback renderer', e);
            return fallbackMarkdown(text);
        }

        if (isStreaming) {
            throw new Error('marked.parse unavailable during streaming');
        }

        return fallbackMarkdown(text);
    }

    function fallbackMarkdown(text) {
        let processedText = text;

        const fences = (processedText.match(/```/g) || []).length;
        if (fences % 2 !== 0) {
            processedText += '\n```';
        }
        const textWithoutFences = processedText.replace(/```[\s\S]*?(```|$)/g, '');
        const singleBackticks = (textWithoutFences.match(/`/g) || []).length;
        if (singleBackticks % 2 !== 0) {
            processedText += '`';
        }

        let formatted = escapeHtml(processedText);
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
