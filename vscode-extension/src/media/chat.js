(function () {
    const vscode = acquireVsCodeApi();

    const messagesContainer = document.getElementById("chat-messages");
    const promptInput = document.getElementById("prompt-input");
    const sendBtn = document.getElementById("send-btn");
    const modelSelect = document.getElementById("model-select");
    const personaSelect = document.getElementById("persona-select");
    const historyBtn = document.getElementById("history-btn");
    const newChatBtn = document.getElementById("new-chat-btn");
    const historyDrawer = document.getElementById("history-drawer");
    const historyList = document.getElementById("history-list");
    const activeSessionsCount = document.getElementById("active-sessions-count");

    // Export Controls
    const exportMenuBtn = document.getElementById("export-menu-btn");
    const exportDropdownMenu = document.getElementById("export-dropdown-menu");
    const copyMarkdownBtn = document.getElementById("copy-markdown-btn");
    const insertActiveFileBtn = document.getElementById("insert-active-file-btn");

    let currentConversation = null;
    let runningConversationIds = [];
    let isGenerating = false;

    // Handle messages sent from Extension Host
    window.addEventListener("message", event => {
        const message = event.data;

        switch (message.type) {
            case "initSession":
                currentConversation = message.session;
                runningConversationIds = message.runningConversationIds || [];
                updateModelSelect(message.models, message.selectedModel);
                updatePersonaSelect(message.personas, message.selectedPersona);
                renderConversation(currentConversation, message.isGenerating, message.partialText);
                break;
            case "updateModels":
                updateModelSelect(message.models, message.selectedModel);
                break;
            case "updateHistoryList":
                runningConversationIds = message.runningConversationIds || [];
                renderHistoryList(message.conversations, runningConversationIds, message.activeConversationId);
                break;
            case "streamToken":
                if (message.appendInput && promptInput) {
                    promptInput.value += message.appendInput;
                    vscode.setState({ text: promptInput.value });
                    promptInput.scrollTop = promptInput.scrollHeight;
                    break;
                }
                // Only render token into UI if it matches active conversation
                if (!message.conversationId || (currentConversation && message.conversationId === currentConversation.id)) {
                    appendStreamToken(message.text, message.thinking);
                }
                break;
            case "streamEnd":
                // Only finalize active UI if matching current session
                if (!message.conversationId || (currentConversation && message.conversationId === currentConversation.id)) {
                    finalizeStreamResponse();
                }
                break;
        }
    });

    function updatePersonaSelect(personas, selectedPersona) {
        if (!personaSelect) return;

        const currentState = vscode.getState();
        const activePersona = selectedPersona || (currentState && currentState.selectedPersona) || personaSelect.value || "";

        personaSelect.innerHTML = '<option value="">Default Persona</option>';

        if (Array.isArray(personas) && personas.length > 0) {
            const hasCategories = personas.some(p => p.category);
            if (hasCategories) {
                const categoryMap = new Map();
                personas.forEach(p => {
                    const cat = p.category || "General";
                    if (!categoryMap.has(cat)) {
                        categoryMap.set(cat, []);
                    }
                    categoryMap.get(cat).push(p);
                });

                categoryMap.forEach((personaList, categoryName) => {
                    const group = document.createElement("optgroup");
                    group.label = categoryName;
                    personaList.forEach(p => {
                        const opt = document.createElement("option");
                        opt.value = p.id;
                        opt.textContent = `${p.name} (${p.slash_command})`;
                        const skillsSnippet = (p.skills && p.skills.length) ? `\nSkills: ${p.skills.slice(0, 3).join(", ")}...` : "";
                        opt.title = (p.description || p.name) + skillsSnippet;
                        if (p.id === activePersona) {
                            opt.selected = true;
                        }
                        group.appendChild(opt);
                    });
                    personaSelect.appendChild(group);
                });
            } else {
                personas.forEach(p => {
                    const opt = document.createElement("option");
                    opt.value = p.id;
                    opt.textContent = `${p.name} (${p.slash_command})`;
                    opt.title = p.description || p.name;
                    if (p.id === activePersona) {
                        opt.selected = true;
                    }
                    personaSelect.appendChild(opt);
                });
            }
        }
    }

    function updateModelSelect(models, selectedModel) {
        if (!modelSelect) return;

        const currentState = vscode.getState();
        const activeModel = selectedModel || (currentState && currentState.selectedModel) || modelSelect.value || "podllama-chat";

        modelSelect.innerHTML = "";

        const allowedChatAliases = new Set(["podllama-chat", "podllama-thinking", "podllama-instruct"]);
        const filteredModels = (models || []).filter(m => m.id && allowedChatAliases.has(m.id));

        if (filteredModels.length === 0) {
            const opt = document.createElement("option");
            opt.value = activeModel;
            opt.textContent = activeModel;
            modelSelect.appendChild(opt);
            return;
        }

        let foundSelected = false;
        filteredModels.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.id;
            opt.textContent = m.id;
            if (m.id === activeModel) {
                opt.selected = true;
                foundSelected = true;
            }
            modelSelect.appendChild(opt);
        });

        if (!foundSelected && modelSelect.options.length > 0) {
            modelSelect.options[0].selected = true;
        }
    }

    function renderConversation(conv, generatingNow = false, partialText = "") {
        if (!messagesContainer) return;

        // Reset active stream turn state
        activeStreamTurn = null;
        activeStreamContentElement = null;
        streamDataBuffer = "";
        lastGoodHtml = "";
        messagesContainer.innerHTML = "";

        const titleInput = document.getElementById("chat-title-input");
        if (titleInput && conv) {
            titleInput.value = conv.title || "Untitled Chat";
        }

        const hasPastMessages = conv && conv.messages && conv.messages.length > 0;

        if (!hasPastMessages && !generatingNow && !partialText) {
            messagesContainer.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); margin-top: 40px;">
                    <p style="font-size: 14px; font-weight: 500;">Welcome to PodLlama Code</p>
                    <p style="font-size: 12px; margin-top: 6px;">Ask a question, @ to mention, / for actions.</p>
                </div>
            `;
            setGeneratingState(false);
            return;
        }

        if (hasPastMessages) {
            conv.messages.forEach(msg => {
                appendMessageTurn(msg.role, msg.content, msg.thinking);
            });
        }

        // If this session is mid-stream, restore active assistant turn with streamed text
        if (generatingNow || partialText) {
            setGeneratingState(true);
            appendStreamToken(partialText || "");
        } else {
            setGeneratingState(false);
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function appendMessageTurn(role, content, thinking) {
        const turnDiv = document.createElement("div");
        turnDiv.className = `message-turn ${role}`;

        turnDiv.innerHTML = `<div class="message-content">${formatMarkdown(content)}</div>`;

        messagesContainer.appendChild(turnDiv);
        attachCodeBlockActions(turnDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    let activeStreamTurn = null;
    let activeStreamContentElement = null;
    let streamDataBuffer = "";
    let lastGoodHtml = "";
    let streamRenderScheduled = false;

    function renderStream() {
        if (!activeStreamContentElement) return;

        try {
            const html = formatMarkdown(streamDataBuffer, true);
            
            if (html && typeof html === "string" && html.trim().length > 0) {
                lastGoodHtml = html;
                activeStreamContentElement.style.whiteSpace = "";
                activeStreamContentElement.innerHTML = html;
                attachCodeBlockActions(activeStreamContentElement, true);
            } else if (lastGoodHtml) {
                activeStreamContentElement.style.whiteSpace = "";
                activeStreamContentElement.innerHTML = lastGoodHtml;
            }
        } catch (err) {
            if (lastGoodHtml) {
                activeStreamContentElement.style.whiteSpace = "";
                activeStreamContentElement.innerHTML = lastGoodHtml;
            }
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        streamRenderScheduled = false;
    }

    function appendStreamToken(text, thinking) {
        if (!activeStreamTurn || !activeStreamContentElement) {
            activeStreamTurn = document.createElement("div");
            activeStreamTurn.className = "message-turn assistant";
            
            activeStreamContentElement = document.createElement("div");
            activeStreamContentElement.className = "message-content";
            
            activeStreamTurn.appendChild(activeStreamContentElement);
            messagesContainer.appendChild(activeStreamTurn);

            streamDataBuffer = "";
            lastGoodHtml = "";
        }

        if (text !== undefined && text !== null) {
            streamDataBuffer += text;
            
            if (!streamRenderScheduled) {
                streamRenderScheduled = true;
                requestAnimationFrame(renderStream);
            }
        }
    }

    function finalizeStreamResponse() {
        if (activeStreamTurn && activeStreamContentElement) {
            if (streamDataBuffer) {
                activeStreamContentElement.style.whiteSpace = "";
                try {
                    const html = formatMarkdown(streamDataBuffer, false);
                    if (html && html.trim().length > 0) {
                        activeStreamContentElement.innerHTML = html;
                    } else if (lastGoodHtml) {
                        activeStreamContentElement.innerHTML = lastGoodHtml;
                    } else {
                        activeStreamContentElement.innerHTML = fallbackMarkdown(streamDataBuffer);
                    }
                } catch (e) {
                    if (lastGoodHtml) {
                        activeStreamContentElement.innerHTML = lastGoodHtml;
                    } else {
                        activeStreamContentElement.innerHTML = fallbackMarkdown(streamDataBuffer);
                    }
                }
                attachCodeBlockActions(activeStreamContentElement, false);
            }
        }
        activeStreamTurn = null;
        activeStreamContentElement = null;
        streamDataBuffer = "";
        lastGoodHtml = "";
        setGeneratingState(false);
    }

    function setGeneratingState(generating) {
        isGenerating = generating;
        if (!sendBtn) return;
        if (generating) {
            sendBtn.innerHTML = '<i class="fa-solid fa-circle-stop" style="font-size: 15px;"></i>';
            sendBtn.style.color = "var(--syntax-keyword, #f47067)";
            sendBtn.title = "Stop Generation";
        } else {
            sendBtn.innerHTML = '<i class="fa-solid fa-circle-play" style="font-size: 22px;"></i>';
            sendBtn.style.color = "var(--accent)";
            sendBtn.title = "Send Message";
        }
    }

    function attachCodeBlockActions(container, isStreaming = false) {
        const pres = container.querySelectorAll("pre");
        pres.forEach(pre => {
            if (pre.querySelector(".code-actions")) return;

            const codeEl = pre.querySelector("code");
            if (!isStreaming && codeEl && typeof hljs !== "undefined") {
                hljs.highlightElement(codeEl);
            }

            const actionsDiv = document.createElement("div");
            actionsDiv.className = "code-actions";

            const copyBtn = document.createElement("button");
            copyBtn.className = "copy-btn";
            copyBtn.textContent = "Copy";
            copyBtn.onclick = () => {
                const code = pre.querySelector("code")?.innerText || "";
                navigator.clipboard.writeText(code);
                copyBtn.textContent = "Copied!";
                setTimeout(() => copyBtn.textContent = "Copy", 1500);
            };

            const patchBtn = document.createElement("button");
            patchBtn.className = "patch-btn";
            patchBtn.textContent = "Apply to Editor";
            patchBtn.onclick = () => {
                const code = pre.querySelector("code")?.innerText || "";
                vscode.postMessage({ command: "applyPatch", code });
            };

            actionsDiv.appendChild(copyBtn);
            actionsDiv.appendChild(patchBtn);
            pre.appendChild(actionsDiv);
        });
    }

    if (typeof marked !== "undefined") {
        marked.setOptions({
            langPrefix: "language-"
        });
    }

    function renderLatex(text) {
        if (typeof katex === "undefined" || !text) return text;

        const codeBlocks = [];
        let cleanText = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
            const placeholder = `%%CODE_BLOCK_${codeBlocks.length}%%`;
            codeBlocks.push(match);
            return placeholder;
        });

        cleanText = cleanText.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
            try {
                return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
            } catch (e) {
                return `$$${math}$$`;
            }
        });

        cleanText = cleanText.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
            try {
                return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
            } catch (e) {
                return `\\[${math}\\]`;
            }
        });

        cleanText = cleanText.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
            try {
                return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
            } catch (e) {
                return `\\(${math}\\)`;
            }
        });

        cleanText = cleanText.replace(/(?<!\\)\$([^$\n]+?)\$/g, (_, math) => {
            if (/^\d+(?:\.\d+)?$/.test(math.trim())) {
                return `$${math}$`;
            }
            try {
                return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
            } catch (e) {
                return `$${math}$`;
            }
        });

        codeBlocks.forEach((cb, idx) => {
            cleanText = cleanText.replace(`%%CODE_BLOCK_${idx}%%`, cb);
        });

        return cleanText;
    }

    function formatMarkdown(text, isStreaming = false) {
        if (!text) return "";
        
        try {
            if (typeof marked !== "undefined" && marked.parse) {
                let processedText = text;
                
                const fences = (processedText.match(/```/g) || []).length;
                if (fences % 2 !== 0) {
                    processedText += "\n```";
                }

                const tildes = (processedText.match(/~~~/g) || []).length;
                if (tildes % 2 !== 0) {
                    processedText += "\n~~~";
                }

                const textWithoutFences = processedText.replace(/```[\s\S]*?(```|$)/g, "").replace(/~~~[\s\S]*?(~~~|$)/g, "");
                const singleBackticks = (textWithoutFences.match(/`/g) || []).length;
                if (singleBackticks % 2 !== 0) {
                    processedText += "`";
                }

                const codeStarts = (processedText.match(/<code[\s>]/gi) || []).length;
                const codeEnds = (processedText.match(/<\/code>/gi) || []).length;
                if (codeStarts > codeEnds) {
                    processedText += "</code>";
                }

                const preStarts = (processedText.match(/<pre[\s>]/gi) || []).length;
                const preEnds = (processedText.match(/<\/pre>/gi) || []).length;
                if (preStarts > preEnds) {
                    processedText += "</pre>";
                }

                const commentStarts = (processedText.match(/<!--/g) || []).length;
                const commentEnds = (processedText.match(/-->/g) || []).length;
                if (commentStarts > commentEnds) {
                    processedText += "-->";
                }

                processedText = processedText.replace(/<(script|style|textarea|svg|iframe)([\s>])/gi, "&lt;$1$2");
                processedText = processedText.replace(/<\/(script|style|textarea|svg|iframe)>/gi, "&lt;/$1&gt;");
                processedText = renderLatex(processedText);

                const parsed = marked.parse(processedText);
                if (typeof parsed === "string" && parsed.trim().length > 0) {
                    return parsed;
                }
            }
        } catch (e) {
            console.warn("[PodLlama] marked.parse failed, using fallback renderer", e);
            return fallbackMarkdown(text);
        }

        return fallbackMarkdown(text);
    }

    function fallbackMarkdown(text) {
        let processedText = text;

        const fences = (processedText.match(/```/g) || []).length;
        if (fences % 2 !== 0) {
            processedText += "\n```";
        }
        const textWithoutFences = processedText.replace(/```[\s\S]*?(```|$)/g, "");
        const singleBackticks = (textWithoutFences.match(/`/g) || []).length;
        if (singleBackticks % 2 !== 0) {
            processedText += "`";
        }

        let formatted = escapeHtml(processedText);
        formatted = formatted.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code class="language-${lang}">${code}</code></pre>`;
        });
        formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");
        formatted = renderLatex(formatted);
        return formatted;
    }

    function escapeHtml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function formatSessionAsMarkdown(conv) {
        if (!conv || !conv.messages || conv.messages.length === 0) {
            return "# PodLlama Chat\n\n*Empty conversation*";
        }

        let md = `# ${conv.title || "PodLlama Chat"}\n\n`;
        if (conv.createdAt) {
            md += `*Date: ${new Date(conv.createdAt).toLocaleString()}*\n`;
        }
        if (conv.selectedModel) {
            md += `*Model: ${conv.selectedModel}*\n`;
        }
        md += "\n---\n\n";

        conv.messages.forEach(msg => {
            const roleTitle = msg.role === "user" ? "👤 User" : `🤖 Assistant${msg.model ? ` (${msg.model})` : ""}`;
            md += `### ${roleTitle}\n\n`;
            if (msg.thinking) {
                md += `> **Thought Process:**\n> ${msg.thinking.replace(/\n/g, "\n> ")}\n\n`;
            }
            md += `${msg.content}\n\n`;
        });

        return md.trim();
    }

    // UI Event Listeners
    if (exportMenuBtn && exportDropdownMenu) {
        exportMenuBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            exportDropdownMenu.classList.toggle("open");
            if (historyDrawer) {
                historyDrawer.classList.remove("open");
            }
        });

        document.addEventListener("click", (e) => {
            if (!exportDropdownMenu.contains(e.target) && e.target !== exportMenuBtn) {
                exportDropdownMenu.classList.remove("open");
            }
        });
    }

    if (copyMarkdownBtn) {
        copyMarkdownBtn.addEventListener("click", () => {
            const md = formatSessionAsMarkdown(currentConversation);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(md).catch(() => {});
            }
            vscode.postMessage({ command: "copyToClipboard", text: md });

            const originalHtml = copyMarkdownBtn.innerHTML;
            copyMarkdownBtn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--syntax-addition, #57ab5a);"></i><span>Copied!</span>';
            setTimeout(() => {
                copyMarkdownBtn.innerHTML = originalHtml;
                if (exportDropdownMenu) {
                    exportDropdownMenu.classList.remove("open");
                }
            }, 800);
        });
    }

    if (insertActiveFileBtn) {
        insertActiveFileBtn.addEventListener("click", () => {
            const md = formatSessionAsMarkdown(currentConversation);
            vscode.postMessage({ command: "insertToActiveFile", markdown: md });
            if (exportDropdownMenu) {
                exportDropdownMenu.classList.remove("open");
            }
        });
    }

    if (sendBtn && promptInput) {
        sendBtn.addEventListener("click", () => {
            if (isGenerating) {
                // Trigger Stop Action for active conversation
                vscode.postMessage({
                    command: "stopGeneration",
                    conversationId: currentConversation ? currentConversation.id : undefined
                });
                setGeneratingState(false);
                return;
            }

            const prompt = promptInput.value.trim();
            if (!prompt) return;

            const selectedModel = modelSelect ? modelSelect.value : "podllama-chat";
            const selectedPersona = personaSelect ? personaSelect.value : "";

            appendMessageTurn("user", prompt);
            setGeneratingState(true);
            
            vscode.postMessage({
                command: "sendMessage",
                prompt,
                model: selectedModel,
                persona: selectedPersona,
                conversationId: currentConversation ? currentConversation.id : undefined
            });

            promptInput.value = "";
            vscode.setState({ text: "" });
        });

        // Restore saved textarea state on load
        const previousState = vscode.getState();
        if (previousState && previousState.text) {
            promptInput.value = previousState.text;
        }

        promptInput.addEventListener("input", () => {
            vscode.setState({ text: promptInput.value });
        });

        promptInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendBtn.click();
            }
        });
    }

    if (newChatBtn) {
        newChatBtn.addEventListener("click", () => {
            if (historyDrawer) {
                historyDrawer.classList.remove("open");
            }
            if (exportDropdownMenu) {
                exportDropdownMenu.classList.remove("open");
            }
            vscode.postMessage({ command: "newConversation" });
        });
    }

    const chatTitleInput = document.getElementById("chat-title-input");
    if (chatTitleInput) {
        const saveTitleRename = () => {
            const title = chatTitleInput.value.trim();
            if (title && currentConversation && title !== currentConversation.title) {
                currentConversation.title = title;
                vscode.postMessage({
                    command: "renameConversation",
                    title,
                    conversationId: currentConversation.id
                });
            }
        };

        chatTitleInput.addEventListener("blur", saveTitleRename);
        chatTitleInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                chatTitleInput.blur();
            }
        });
    }

    const addContextBtn = document.getElementById("add-context-btn");
    if (addContextBtn) {
        addContextBtn.addEventListener("click", () => {
            vscode.postMessage({ command: "addContextAttachment" });
        });
    }

    if (modelSelect) {
        modelSelect.addEventListener("change", () => {
            const selectedModel = modelSelect.value;
            const currentState = vscode.getState() || {};
            vscode.setState({ ...currentState, selectedModel: selectedModel });
            vscode.postMessage({ command: "selectModel", model: selectedModel });
        });
    }

    if (personaSelect) {
        personaSelect.addEventListener("change", () => {
            const selectedPersona = personaSelect.value;
            const currentState = vscode.getState() || {};
            vscode.setState({ ...currentState, selectedPersona: selectedPersona });
            vscode.postMessage({ command: "selectPersona", persona: selectedPersona });
        });
    }

    if (historyBtn && historyDrawer) {
        historyBtn.addEventListener("click", () => {
            historyDrawer.classList.toggle("open");
            if (exportDropdownMenu) {
                exportDropdownMenu.classList.remove("open");
            }
            if (historyDrawer.classList.contains("open")) {
                vscode.postMessage({ command: "getHistoryList" });
            }
        });
    }

    function renderHistoryList(conversations, runningIds = [], activeId = null) {
        if (!historyList) return;
        historyList.innerHTML = "";

        const currentActiveId = currentConversation ? currentConversation.id : activeId;
        const activeCount = runningIds.length;

        if (activeSessionsCount) {
            activeSessionsCount.textContent = activeCount > 0 ? `(${activeCount} running)` : "";
        }

        if (!conversations || conversations.length === 0) {
            historyList.innerHTML = '<li style="color: var(--text-muted); font-size: 12px; padding: 6px;">No past conversations</li>';
            return;
        }

        conversations.forEach(c => {
            const isRunning = runningIds.includes(c.id);
            const isActive = c.id === currentActiveId;

            const li = document.createElement("li");
            li.className = `history-item ${isActive ? "active" : ""}`;

            const statusBadge = isRunning ? 
                '<span class="history-status-badge"><i class="fa-solid fa-spinner fa-spin"></i> Generating</span>' : "";

            li.innerHTML = `
                <div class="history-item-left">
                    <span class="history-item-title">${escapeHtml(c.title || "Untitled Chat")}</span>
                    ${statusBadge}
                </div>
                <button class="icon-btn delete-conv-btn" data-id="${c.id}" title="Delete Conversation">✕</button>
            `;

            li.onclick = (e) => {
                if (e.target.classList.contains("delete-conv-btn")) {
                    e.stopPropagation();
                    vscode.postMessage({ command: "deleteConversation", id: c.id });
                } else {
                    vscode.postMessage({ command: "selectConversation", id: c.id });
                    if (historyDrawer) {
                        historyDrawer.classList.remove("open");
                    }
                }
            };
            historyList.appendChild(li);
        });
    }
})();
