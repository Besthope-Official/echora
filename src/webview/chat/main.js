(function () {
	const vscode = acquireVsCodeApi();
	const container = document.getElementById('messages');
	const stateEl = document.getElementById('state-indicator');
	const draftWrap = document.getElementById('draft-wrap');
	const draftInput = document.getElementById('draft-input');
	const sendBtn = document.getElementById('send-btn');

	let currentAssistantEl = null;
	let currentThinkDetails = null;
	let currentThinkBody = null;
	let thinkingDetails = null;
	let thinkingBlock = null;
	let thinkingStartTime = null;
	let thinkingTimerInterval = null;
	let thinkingStateStartTime = null;
	let thinkingStateTimerInterval = null;
	let hasPendingDraft = false;

	sendBtn.addEventListener('click', sendPendingTranscription);
	draftInput.addEventListener('keydown', (event) => {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			sendPendingTranscription();
		}
	});

	window.addEventListener('message', (event) => {
		const msg = event.data;
		switch (msg.type) {
			case 'userMessage': {
				finishAssistant();
				thinkingStartTime = Date.now();
				const msgEl = document.createElement('div');
				msgEl.className = 'msg user';
				msgEl.textContent = msg.text;
				if (msg.editorContextHint) {
					const turn = document.createElement('div');
					turn.className = 'user-turn';
					turn.appendChild(msgEl);
					const footnote = document.createElement('div');
					footnote.className = 'msg-context-footnote';
					footnote.textContent = msg.editorContextHint;
					turn.appendChild(footnote);
					container.appendChild(turn);
				} else {
					container.appendChild(msgEl);
				}
				scrollToBottom();
				break;
			}
			case 'assistantDelta': {
				if (!currentAssistantEl) {
					currentAssistantEl = document.createElement('div');
					currentAssistantEl.className = 'msg assistant markdown';
					container.appendChild(currentAssistantEl);
				}
				const raw = (currentAssistantEl.dataset.rawMarkdown || '') + msg.text;
				currentAssistantEl.dataset.rawMarkdown = raw;
				currentAssistantEl.innerHTML = renderMarkdown(raw);
				scrollToBottom();
				break;
			}
			case 'assistantThinkingDelta': {
				const thinkBody = ensureAssistantThinkMessage();
				const raw = (thinkBody.dataset.rawMarkdown || '') + msg.text;
				thinkBody.dataset.rawMarkdown = raw;
				thinkBody.innerHTML = renderMarkdown(raw, { enableThinkingBlocks: false });
				scrollToBottom();
				break;
			}
			case 'assistantDone': {
				finishAssistant();
				break;
			}
			case 'error': {
				finishAssistant();
				const el = document.createElement('div');
				el.className = 'msg error';
				el.textContent = msg.message;
				container.appendChild(el);
				scrollToBottom();
				break;
			}
			case 'stateChanged': {
				updateStateIndicator(msg.state);
				const isBusy = msg.state === 'thinking' || msg.state === 'transcribing' || msg.state === 'speaking';
				if (hasPendingDraft) {
					sendBtn.disabled = isBusy;
				}
				break;
			}
			case 'pendingTranscription': {
				hasPendingDraft = true;
				draftWrap.style.display = 'block';
				draftInput.value = msg.text;
				sendBtn.disabled = false;
				draftInput.focus();
				const len = draftInput.value.length;
				draftInput.setSelectionRange(len, len);
				scrollToBottom();
				break;
			}
			case 'pendingCleared': {
				hasPendingDraft = false;
				draftInput.value = '';
				sendBtn.disabled = false;
				draftWrap.style.display = 'none';
				break;
			}
			case 'loadHistory': {
				for (const entry of msg.entries) {
					const hasThinkingSteps = Array.isArray(entry.thinkingSteps) && entry.thinkingSteps.length > 0;
					const hasThinkingContent = typeof entry.thinkingContent === 'string' && entry.thinkingContent.trim().length > 0;
					if (entry.role === 'assistant' && (hasThinkingSteps || hasThinkingContent)) {
						container.appendChild(
							buildHistoryThinkingBlock(entry.thinkingSteps || [], entry.thinkingDurationSeconds, entry.thinkingContent)
						);
					}
					const el = document.createElement('div');
					if (entry.role === 'assistant') {
						el.className = 'msg assistant markdown';
						el.dataset.rawMarkdown = entry.content;
						el.innerHTML = renderMarkdown(entry.content);
					} else {
						el.className = 'msg user';
						el.textContent = entry.content;
					}
					if (entry.role === 'user' && entry.editorContextHint) {
						const turn = document.createElement('div');
						turn.className = 'user-turn';
						turn.appendChild(el);
						const footnote = document.createElement('div');
						footnote.className = 'msg-context-footnote';
						footnote.textContent = entry.editorContextHint;
						turn.appendChild(footnote);
						container.appendChild(turn);
					} else {
						container.appendChild(el);
					}
				}
				scrollToBottom();
				break;
			}
			case 'toolUse': {
				const block = ensureThinkingBlock();
				const row = document.createElement('div');
				row.className = 'tool-row';
				row.dataset.toolUseId = msg.toolUseId;
				row.innerHTML =
					'<span class="tool-icon">*</span>' +
					`<span class="tool-label">${esc(msg.toolName)}</span>` +
					`<span class="tool-input">(${esc(msg.inputSummary)})</span>` +
					'<span class="tool-elapsed"></span>' +
					'<span class="tool-status"></span>';
				block.appendChild(row);
				scrollToBottom();
				break;
			}
			case 'toolProgress': {
				const row = findToolRow(msg.toolUseId);
				if (row) {
					const elapsedEl = row.querySelector('.tool-elapsed');
					if (elapsedEl) {
						elapsedEl.textContent = `${msg.elapsedSeconds.toFixed(1)}s`;
					}
				} else {
					const block = ensureThinkingBlock();
					const newRow = document.createElement('div');
					newRow.className = 'tool-row';
					newRow.dataset.toolUseId = msg.toolUseId;
					newRow.innerHTML =
						'<span class="tool-icon">*</span>' +
						`<span class="tool-label">${esc(msg.toolName)}</span>` +
						'<span class="tool-input"></span>' +
						`<span class="tool-elapsed">${msg.elapsedSeconds.toFixed(1)}s</span>` +
						'<span class="tool-status"></span>';
					block.appendChild(newRow);
					scrollToBottom();
				}
				break;
			}
			case 'toolResult': {
				let row = findToolRow(msg.toolUseId);
				if (!row) {
					const block = ensureThinkingBlock();
					row = document.createElement('div');
					row.className = 'tool-row';
					row.dataset.toolUseId = msg.toolUseId;
					row.innerHTML =
						'<span class="tool-icon">*</span>' +
						'<span class="tool-label">Unknown Tool</span>' +
						'<span class="tool-input"></span>' +
						'<span class="tool-elapsed"></span>' +
						'<span class="tool-status"></span>';
					block.appendChild(row);
				}
				const statusEl = row.querySelector('.tool-status');
				if (statusEl) {
					statusEl.textContent = msg.isError ? ' [err]' : ' [ok]';
					statusEl.className = msg.isError ? 'tool-status tool-err' : 'tool-status tool-ok';
				}
				if (msg.isError && msg.content) {
					const errEl = document.createElement('div');
					errEl.className = 'tool-result-error';
					errEl.textContent = msg.content;
					row.insertAdjacentElement('afterend', errEl);
				}
				break;
			}
			case 'toolUseSummary':
				break;
			case 'taskStarted': {
				const block = ensureThinkingBlock();
				const taskEl = document.createElement('div');
				taskEl.className = 'task-row';
				taskEl.dataset.taskId = msg.taskId;
				taskEl.innerHTML =
					'<span class="task-icon">#</span>' +
					`<span class="task-desc">${esc(msg.description)}</span>`;
				block.appendChild(taskEl);
				scrollToBottom();
				break;
			}
			case 'taskProgress': {
				const taskSelector = `.task-row[data-task-id="${escapeSelectorValue(msg.taskId)}"]`;
				const taskEl = container.querySelector(taskSelector);
				if (taskEl) {
					const desc = taskEl.querySelector('.task-desc');
					if (desc) {
						desc.textContent = msg.description + (msg.lastToolName ? ` (${msg.lastToolName})` : '');
					}
				}
				break;
			}
		}
	});

	function ensureThinkingBlock() {
		if (!thinkingDetails) {
			thinkingDetails = document.createElement('details');
			thinkingDetails.className = 'thinking-details';
			thinkingDetails.open = true;

			const summary = document.createElement('summary');
			summary.className = 'thinking-summary';
			summary.innerHTML =
				'<span class="thinking-chevron">&#9654;</span>' +
				'<span class="thinking-label">thinking</span>' +
				'<span class="thinking-sep">...</span>' +
				'<span class="thinking-timer">0s</span>';

			thinkingBlock = document.createElement('div');
			thinkingBlock.className = 'thinking-block';

			thinkingDetails.appendChild(summary);
			thinkingDetails.appendChild(thinkingBlock);
			container.appendChild(thinkingDetails);
			startThinkingTimer();

			scrollToBottom();
		}
		return thinkingBlock;
	}

	function ensureAssistantThinkMessage() {
		if (!currentThinkDetails) {
			currentThinkDetails = document.createElement('details');
			currentThinkDetails.className = 'thinking-details';
			currentThinkDetails.open = false;

			const summary = document.createElement('summary');
			summary.className = 'thinking-summary';
			summary.innerHTML =
				'<span class="thinking-chevron">&#9654;</span>' +
				'<span class="thinking-label">thinking</span>' +
				'<span class="thinking-sep">...</span>' +
				'<span class="thinking-timer">0s</span>';

			const block = document.createElement('div');
			block.className = 'thinking-block';
			currentThinkBody = document.createElement('div');
			currentThinkBody.className = 'history-think-body markdown';

			block.appendChild(currentThinkBody);
			currentThinkDetails.appendChild(summary);
			currentThinkDetails.appendChild(block);
			container.appendChild(currentThinkDetails);
		}
		startThinkingTimer();
		return currentThinkBody;
	}

	function buildHistoryThinkingBlock(steps, durationSeconds, thinkingContent) {
		const details = document.createElement('details');
		details.className = 'thinking-details';

		const dur = durationSeconds || 0;
		const summary = document.createElement('summary');
		summary.className = 'thinking-summary';
		summary.innerHTML =
			'<span class="thinking-chevron">&#9654;</span>' +
			'<span class="thinking-label">thought for</span>' +
			'<span class="thinking-sep"></span>' +
			`<span class="thinking-timer">${dur}s</span>`;

		const block = document.createElement('div');
		block.className = 'thinking-block';

		const rawThinking = typeof thinkingContent === 'string' ? thinkingContent : '';
		if (rawThinking.trim().length > 0) {
			const thinkingEl = document.createElement('div');
			thinkingEl.className = 'history-think-body markdown';
			thinkingEl.dataset.rawMarkdown = rawThinking;
			thinkingEl.innerHTML = renderMarkdown(rawThinking, { enableThinkingBlocks: false });
			block.appendChild(thinkingEl);
		}

		for (const step of steps) {
			if (step.type === 'tool') {
				const row = document.createElement('div');
				row.className = 'tool-row';
				const elapsed = (step.elapsedSeconds || 0).toFixed(1);
				row.innerHTML =
					'<span class="tool-icon">*</span>' +
					`<span class="tool-label">${esc(step.toolName || '')}</span>` +
					`<span class="tool-input">(${esc(step.inputSummary || '')})</span>` +
					`<span class="tool-elapsed">${elapsed}s</span>` +
					`<span class="${step.isError ? 'tool-err' : 'tool-ok'}">${step.isError ? ' [err]' : ' [ok]'}</span>`;
				block.appendChild(row);
			} else if (step.type === 'task') {
				const taskEl = document.createElement('div');
				taskEl.className = 'task-row';
				taskEl.innerHTML =
					'<span class="task-icon">#</span>' +
					`<span class="task-desc">${esc(step.description || '')}</span>`;
				block.appendChild(taskEl);
			}
		}

		details.appendChild(summary);
		details.appendChild(block);
		return details;
	}

	function updateStateIndicator(state) {
		if (state === 'thinking') {
			startThinkingStateTimer();
			return;
		}
		stopThinkingStateTimer();
		stateEl.textContent = state === 'idle' ? '' : state === 'awaitingSend' ? 'awaiting send...' : `${state}...`;
	}

	function startThinkingStateTimer() {
		if (!thinkingStateStartTime) {
			thinkingStateStartTime = Date.now();
		}
		stateEl.textContent = `thinking... ${Math.round((Date.now() - thinkingStateStartTime) / 1000)}s`;
		if (thinkingStateTimerInterval) {
			return;
		}
		thinkingStateTimerInterval = setInterval(() => {
			if (!thinkingStateStartTime) {
				return;
			}
			stateEl.textContent = `thinking... ${Math.round((Date.now() - thinkingStateStartTime) / 1000)}s`;
		}, 1000);
	}

	function stopThinkingStateTimer() {
		if (thinkingStateTimerInterval) {
			clearInterval(thinkingStateTimerInterval);
			thinkingStateTimerInterval = null;
		}
		thinkingStateStartTime = null;
	}

	function findToolRow(toolUseId) {
		const selector = `.tool-row[data-tool-use-id="${escapeSelectorValue(toolUseId)}"]`;
		return container.querySelector(selector);
	}

	function escapeSelectorValue(value) {
		if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
			return CSS.escape(value);
		}
		return String(value).replace(/["\\]/g, '\\$&');
	}

	function esc(value) {
		return String(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function renderMarkdown(markdownText, options) {
		const enableThinkingBlocks = options?.enableThinkingBlocks !== false;
		const raw = String(markdownText || '');
		const codeBlocks = [];
		const codeBlockPattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
		const withCodePlaceholders = raw.replace(codeBlockPattern, (_, language, code) => {
			const idx = codeBlocks.length;
			const safeLanguage = esc(language || '');
			const safeCode = esc(code.replace(/\n$/, ''));
			codeBlocks.push(
				`<pre><code${safeLanguage ? ` class="language-${safeLanguage}"` : ''}>${safeCode}</code></pre>`
			);
			return `@@ECHORA_CODE_BLOCK_${idx}@@`;
		});

		const lines = withCodePlaceholders.split(/\r?\n/);
		const html = [];
		let inUl = false;
		let inOl = false;

		const closeLists = () => {
			if (inUl) {
				html.push('</ul>');
				inUl = false;
			}
			if (inOl) {
				html.push('</ol>');
				inOl = false;
			}
		};

		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i];
			const trimmed = line.trim();
			if (!trimmed) {
				closeLists();
				continue;
			}

			if (enableThinkingBlocks && isThinkingHeaderLine(trimmed)) {
				let j = i + 1;
				let hasContinuation = false;
				const bodyLines = [];

				while (j < lines.length) {
					const nextLine = lines[j];
					const nextTrimmed = nextLine.trim();
					if (!nextTrimmed) {
						if (hasContinuation) {
							bodyLines.push('');
							j += 1;
							continue;
						}
						break;
					}
					if (isIndentedContinuationLine(nextLine)) {
						hasContinuation = true;
						bodyLines.push(nextLine.replace(/^[ \t]{2,}/, ''));
						j += 1;
						continue;
					}
					break;
				}

				if (hasContinuation) {
					closeLists();
					const bodyText = bodyLines.join('\n').trim();
					const bodyHtml = bodyText
						? renderMarkdown(bodyText, { enableThinkingBlocks: false })
						: '';
					html.push(
						`<details class="thinking-inline" open><summary><em>Thinking</em></summary><div class="thinking-inline-body">${bodyHtml}</div></details>`
					);
					i = j - 1;
					continue;
				}
			}

			const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
			if (heading) {
				closeLists();
				const level = heading[1].length;
				html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
				continue;
			}

			const ulItem = /^[-*+]\s+(.*)$/.exec(trimmed);
			if (ulItem) {
				if (inOl) {
					html.push('</ol>');
					inOl = false;
				}
				if (!inUl) {
					html.push('<ul>');
					inUl = true;
				}
				html.push(`<li>${renderInlineMarkdown(ulItem[1])}</li>`);
				continue;
			}

			const olItem = /^\d+\.\s+(.*)$/.exec(trimmed);
			if (olItem) {
				if (inUl) {
					html.push('</ul>');
					inUl = false;
				}
				if (!inOl) {
					html.push('<ol>');
					inOl = true;
				}
				html.push(`<li>${renderInlineMarkdown(olItem[1])}</li>`);
				continue;
			}

			closeLists();
			const quote = /^>\s?(.*)$/.exec(trimmed);
			if (quote) {
				html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
				continue;
			}

			html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
		}
		closeLists();

		let rendered = html.join('');
		for (let i = 0; i < codeBlocks.length; i += 1) {
			rendered = rendered.replace(`@@ECHORA_CODE_BLOCK_${i}@@`, codeBlocks[i]);
		}
		return rendered;
	}

	function isThinkingHeaderLine(trimmedLine) {
		const normalized = trimmedLine.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
		return /^[-+]\s+Thinking(\s+\^)?$/i.test(normalized);
	}

	function isIndentedContinuationLine(rawLine) {
		return /^[ \t]{2,}\S/.test(rawLine);
	}

	function renderInlineMarkdown(text) {
		const placeholders = [];
		let safe = esc(text);

		safe = safe.replace(/`([^`]+)`/g, (_, code) => {
			const idx = placeholders.length;
			placeholders.push(`<code>${esc(code)}</code>`);
			return `@@ECHORA_INLINE_CODE_${idx}@@`;
		});

		safe = safe
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/\*([^*]+)\*/g, '<em>$1</em>');

		safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
			const url = sanitizeUrl(href);
			if (!url) {
				return label;
			}
			return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
		});

		for (let i = 0; i < placeholders.length; i += 1) {
			safe = safe.replace(`@@ECHORA_INLINE_CODE_${i}@@`, placeholders[i]);
		}
		return safe;
	}

	function sanitizeUrl(rawUrl) {
		const trimmed = String(rawUrl || '').trim();
		if (!trimmed) {
			return null;
		}
		if (trimmed.startsWith('command:')) {
			return null;
		}
		try {
			const url = new URL(trimmed, 'https://example.invalid');
			const protocol = url.protocol.toLowerCase();
			if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
				return esc(trimmed);
			}
		} catch {
			return null;
		}
		return null;
	}

	function startThinkingTimer() {
		if (!thinkingStartTime) {
			thinkingStartTime = Date.now();
		}
		refreshThinkingTimers();
		if (thinkingTimerInterval) {
			return;
		}
		thinkingTimerInterval = setInterval(() => {
			refreshThinkingTimers();
		}, 1000);
	}

	function refreshThinkingTimers() {
		const elapsed = thinkingStartTime ? Math.round((Date.now() - thinkingStartTime) / 1000) : 0;
		if (thinkingDetails) {
			const timerEl = thinkingDetails.querySelector('.thinking-timer');
			if (timerEl) {
				timerEl.textContent = `${elapsed}s`;
			}
		}
		if (currentThinkDetails) {
			const timerEl = currentThinkDetails.querySelector('.thinking-timer');
			if (timerEl) {
				timerEl.textContent = `${elapsed}s`;
			}
		}
	}

	function finishAssistant() {
		currentAssistantEl = null;
		if (thinkingTimerInterval) {
			clearInterval(thinkingTimerInterval);
			thinkingTimerInterval = null;
		}
		const elapsed = thinkingStartTime ? Math.round((Date.now() - thinkingStartTime) / 1000) : 0;
		if (thinkingDetails) {
			const labelEl = thinkingDetails.querySelector('.thinking-label');
			const sepEl = thinkingDetails.querySelector('.thinking-sep');
			const timerEl = thinkingDetails.querySelector('.thinking-timer');
			if (labelEl) {
				labelEl.textContent = 'thought for';
			}
			if (sepEl) {
				sepEl.textContent = '';
			}
			if (timerEl) {
				timerEl.textContent = `${elapsed}s`;
			}
			thinkingDetails.open = false;
		}
		if (currentThinkDetails) {
			const labelEl = currentThinkDetails.querySelector('.thinking-label');
			const sepEl = currentThinkDetails.querySelector('.thinking-sep');
			const timerEl = currentThinkDetails.querySelector('.thinking-timer');
			if (labelEl) {
				labelEl.textContent = 'thought for';
			}
			if (sepEl) {
				sepEl.textContent = '';
			}
			if (timerEl) {
				timerEl.textContent = `${elapsed}s`;
			}
			currentThinkDetails.open = false;
		}
		currentThinkDetails = null;
		currentThinkBody = null;
		thinkingDetails = null;
		thinkingBlock = null;
		thinkingStartTime = null;
	}

	function scrollToBottom() {
		requestAnimationFrame(() => {
			container.scrollTop = container.scrollHeight;
		});
	}

	function sendPendingTranscription() {
		const text = draftInput.value;
		if (!text.trim()) {
			return;
		}
		sendBtn.disabled = true;
		vscode.postMessage({ type: 'sendPendingTranscription', text });
	}

	vscode.postMessage({ type: 'webviewReady' });
})();
