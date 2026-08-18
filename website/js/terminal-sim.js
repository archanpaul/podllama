/**
 * PodLlama Live Workspace & Terminal Simulator
 * Simulates real-time token streaming, DeepSeek reasoning traces, and LiteLLM packet flow
 */

class TerminalSimulator {
  constructor() {
    this.activeTab = "vscode";
    this.isStreaming = false;
    this.streamInterval = null;
    this.init();
  }

  init() {
    this.setupTabListeners();
    this.startStreaming("vscode");
  }

  setupTabListeners() {
    const tabs = document.querySelectorAll(".mockup-tab");
    tabs.forEach(tab => {
      tab.addEventListener("click", (e) => {
        const targetTab = tab.dataset.tab;
        if (targetTab === this.activeTab) return;

        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");

        document.querySelectorAll(".tab-pane").forEach(pane => pane.classList.remove("active"));
        const targetPane = document.getElementById(`pane-${targetTab}`);
        if (targetPane) targetPane.classList.add("active");

        this.activeTab = targetTab;
        this.startStreaming(targetTab);
      });
    });
  }

  startStreaming(tab) {
    if (this.streamInterval) clearInterval(this.streamInterval);

    if (tab === "vscode") {
      this.streamVSCode();
    } else if (tab === "cli") {
      this.streamCLI();
    } else if (tab === "litellm") {
      this.streamLiteLLM();
    }
  }

  streamVSCode() {
    const container = document.getElementById("vscode-stream-content");
    if (!container) return;

    container.innerHTML = `
      <div class="msg-bubble msg-user">
        <span style="color: var(--accent-blue); font-weight: 600;">User:</span> /prof Explain the time complexity of Heavy-Light Decomposition on a tree with N nodes and formulate the query bound.
      </div>
      <div class="msg-bubble msg-assistant" id="vscode-assistant-box">
        <div class="thought-box" id="vscode-thought-box" style="display: none;">
          <strong style="color: var(--accent-cyan);"><i class="fa-solid fa-brain"></i> Thought Process (DeepSeek-R1 Distill):</strong><br>
          <span id="vscode-thought-text"></span>
        </div>
        <div id="vscode-output-text"></div>
      </div>
    `;

    const thoughtText = "1. Deconstruct tree decomposition: HLD partitions edges into heavy and light paths. 2. Define heavy child: subtree size >= N/2. 3. Light edge traversal halves subtree size: at most log2(N) light edges on any root-to-node path. 4. Point/Range queries on heavy paths map to contiguous intervals in a Segment Tree. 5. Combine bounds: O(log N) path segments * O(log N) segment tree query = O(log^2 N).";
    
    const responseTokens = [
      "### Formal Analysis: Heavy-Light Decomposition (HLD)",
      "<br><br><strong>Theorem:</strong> On an arbitrary rooted tree $T = (V, E)$ with $|V| = N$, any simple path between vertices $u$ and $v$ passes through at most $\\mathcal{O}(\\log N)$ distinct heavy paths.",
      "<br><br><div class="latex-math-box">$$\\text{Path Query Complexity} = \\mathcal{O}(\\log^2 N)$$</div>",
      "<br><strong>Step-by-Step Proof Outline:</strong>",
      "<br>1. <strong>Heavy Vertex Definition</strong>: For each non-leaf $u$, child $v$ maximizing $\\text{size}(v)$ is connected via a <strong>heavy edge</strong>; all other child edges are <strong>light</strong>.",
      "<br>2. <strong>Subtree Bound</strong>: Entering a light edge $(u, w)$ guarantees $\\text{size}(w) \\le \\lfloor \\text{size}(u)/2 \\rfloor$. Hence, any path from root to leaf crosses at most $\\lfloor \\log_2 N \\rfloor$ light edges.",
      "<br>3. <strong>Data Structure Query</strong>: Querying segment intervals along each heavy chain takes $\\mathcal{O}(\\log N)$ using a standard Lazy Segment Tree.",
      "<br><br><div class="code-snippet-box"><span style="color: #79c0ff;">// Fast Range Query across HLD Path</span><br><span style="color: #ff7b72;">int</span> <span style="color: #79c0ff;">query_path</span>(<span style="color: #ff7b72;">int</span> u, <span style="color: #ff7b72;">int</span> v) {<br>&nbsp;&nbsp;<span style="color: #ff7b72;">int</span> res = 0;<br>&nbsp;&nbsp;<span style="color: #ff7b72;">while</span> (head[u] != head[v]) {<br>&nbsp;&nbsp;&nbsp;&nbsp;<span style="color: #ff7b72;">if</span> (depth[head[u]] &lt; depth[head[v]]) std::swap(u, v);<br>&nbsp;&nbsp;&nbsp;&nbsp;res = combine(res, seg_query(1, 0, n-1, pos[head[u]], pos[u]));<br>&nbsp;&nbsp;&nbsp;&nbsp;u = parent[head[u]];<br>&nbsp;&nbsp;}<br>&nbsp;&nbsp;<span style="color: #ff7b72;">if</span> (depth[u] &gt; depth[v]) std::swap(u, v);<br>&nbsp;&nbsp;res = combine(res, seg_query(1, 0, n-1, pos[u], pos[v]));<br>&nbsp;&nbsp;<span style="color: #ff7b72;">return</span> res;<br>}</div>",
      "<br><blockquote style="border-left: 3px solid var(--accent-green); padding-left: 10px; color: var(--accent-green);"><strong>Summary Box:</strong> Heavy-Light Decomposition enables $\\mathcal{O}(\\log^2 N)$ path modifications and $\\mathcal{O}(\\log N)$ subtree queries with strictly $\\mathcal{O}(N)$ auxiliary space.</blockquote>"
    ];

    const thoughtBox = document.getElementById("vscode-thought-box");
    const thoughtSpan = document.getElementById("vscode-thought-text");
    const outputDiv = document.getElementById("vscode-output-text");

    thoughtBox.style.display = "block";
    let thoughtIdx = 0;

    this.streamInterval = setInterval(() => {
      if (thoughtIdx < thoughtText.length) {
        thoughtSpan.textContent = thoughtText.substring(0, thoughtIdx + 4);
        thoughtIdx += 4;
      } else {
        clearInterval(this.streamInterval);
        this.streamVSCodeResponse(outputDiv, responseTokens);
      }
    }, 25);
  }

  streamVSCodeResponse(outputDiv, tokens) {
    let tokenIdx = 0;
    let accumulated = "";

    this.streamInterval = setInterval(() => {
      if (tokenIdx < tokens.length) {
        accumulated += tokens[tokenIdx];
        outputDiv.innerHTML = accumulated + "<span class="cursor-blink"></span>";
        tokenIdx++;
      } else {
        clearInterval(this.streamInterval);
        outputDiv.innerHTML = accumulated;
      }
    }, 90);
  }

  streamCLI() {
    const container = document.getElementById("cli-stream-content");
    if (!container) return;

    container.innerHTML = `
      <div style="color: var(--accent-green);">$ podllama-cli agent --workspace /workspace --model podllama-chat</div>
      <div style="color: var(--text-muted); margin: 6px 0;">[PodLlama Container Agent v1.2.1 • Rootless Podman userns=keep-id]</div>
      <div style="color: var(--text-secondary); margin-bottom: 12px;">Connected to LiteLLM Unified Proxy on http://127.0.0.1:4000/v1</div>
      <div id="cli-typed-content"></div>
    `;

    const lines = [
      "🔍 Scanning workspace repository structure...",
      "  ✓ Found 42 source files (C++20, Python 3.12, YAML)",
      "  ✓ Detected GPU Acceleration: /dev/dri (Intel Arc A770 16GB Vulkan)",
      "  ✓ Active Chat Model: Qwen3.5-9B-Q4_K_M.gguf (VRAM: 6.8 GB, -ngl 99)",
      "",
      "🤖 Agent Task: Refactor mutex lock contention in thread_pool.cpp using lock-free ring buffer",
      "  [1/3] Reading containers/thread_pool.cpp (128 lines)...",
      "  [2/3] Analyzing concurrency bottleneck: lock contention on std::queue push/pop",
      "  [3/3] Generating zero-allocation atomic ring buffer patch...",
      "",
      "✨ Applied Patch: containers/thread_pool.cpp (+48 lines, -26 lines)",
      "  ✓ Unit Tests Passed: 18/18 (tests/unit_tests.py)",
      "  ✓ Smoke Verification: 12/12 stages completed in 1.42s"
    ];

    const typedDiv = document.getElementById("cli-typed-content");
    let lineIdx = 0;

    this.streamInterval = setInterval(() => {
      if (lineIdx < lines.length) {
        const p = document.createElement("div");
        p.textContent = lines[lineIdx];
        if (lines[lineIdx].startsWith("✨")) {
          p.style.color = "var(--accent-cyan)";
          p.style.fontWeight = "600";
        } else if (lines[lineIdx].startsWith("  ✓")) {
          p.style.color = "var(--accent-green)";
        }
        typedDiv.appendChild(p);
        lineIdx++;
      } else {
        clearInterval(this.streamInterval);
      }
    }, 140);
  }

  streamLiteLLM() {
    const container = document.getElementById("litellm-stream-content");
    if (!container) return;

    container.innerHTML = `
      <div style="color: var(--accent-cyan); font-weight: 600;">[podllama_proxy] LiteLLM Gateway Router (Port 4000)</div>
      <div style="color: var(--text-muted); margin-bottom: 12px;">POST /v1/chat/completions (model: "podllama-thinking", stream: true)</div>
      <pre style="background: #0d1117; padding: 12px; border-radius: 6px; border: 1px solid var(--border-muted); font-size: 0.82rem; color: #79c0ff;" id="litellm-sse-packets"></pre>
    `;

    const packets = [
      '{"route": "supervisor", "target_port": 8080, "model": "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf", "status": "200 OK"}',
      'data: {"id":"chatcmpl-01","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Step 1:"}}]}',
      'data: {"id":"chatcmpl-01","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"reasoning_content":" Decompose tree..."}}]}',
      'data: {"id":"chatcmpl-01","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"### Heavy-Light Decomposition"}}]}',
      'data: {"id":"chatcmpl-01","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Complexity is O(log^2 N)."}}]}',
      'data: [DONE]  [Tokens: 489 | Prompt Tokens: 42 | Speed: 46.2 t/s]'
    ];

    const pre = document.getElementById("litellm-sse-packets");
    let pIdx = 0;

    this.streamInterval = setInterval(() => {
      if (pIdx < packets.length) {
        pre.textContent += packets[pIdx] + "\n";
        pIdx++;
      } else {
        clearInterval(this.streamInterval);
      }
    }, 180);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.terminalSim = new TerminalSimulator();
});