# echora README

[![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/Besthope.echora?label=Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=Besthope.echora)
[![VS Code Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/Besthope.echora?label=Installs&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=Besthope.echora)
[![VS Code Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/Besthope.echora?label=Rating&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=Besthope.echora)
[![GitHub Stars](https://img.shields.io/github/stars/Besthope-Official/echora?logo=github)](https://github.com/Besthope-Official/echora/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/Besthope-Official/echora?logo=github)](https://github.com/Besthope-Official/echora/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Besthope-Official/echora?logo=github)](https://github.com/Besthope-Official/echora/pulls)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Besthope-Official/echora/pulls)

Echora is a VS Code extension that empowers your CLI agent with STT/TTS and makes it your best companion — chatting, learning, and working, always echoing to you.

<img src="./media/echora-vscode-banner.png" alt="extension banner" width="720" style="max-width:100%;height:auto;">

## Features

Echora is a UI side extension, and we recommend to use it locally for cli agent requires working on your local file system. Though you can use SSH to connect to a remote server, and run a claude instance to actually edit server side files, but it is not vscode-native, meaning that VS Code remote extension is not working, and you must opt in to do this.

- NodeSpeech voice input (`@vscode/node-speech`): Local Hosted STT AI. Multi-language recognition Supported. 
  - Realtime STT
  - VAD
- Voice pipeline send modes
  - Default: final voice transcription is sent immediately and pipeline enters `thinking`.
  - Optional: enable `echora.pipeline.enableTextEditingBeforeSend` to review/edit transcription in the sidebar and click `Send` (or `Ctrl/Cmd + Enter`) before entering `thinking`.

## Requirements

- VS Code Desktop `>= 1.85`
- Node.js `>= 18` on system PATH (required by Agent SDK for Web Streams API and global `fetch`)
- `ms-vscode.vscode-speech` installed in the current profile
- OS-level microphone permission granted for VS Code
- If using `echora.pipeline.textConsumer = agent-sdk`: run `pnpm add @anthropic-ai/claude-agent-sdk` and ensure Claude authentication is ready
- For debugging, use launch config: `Run Extension (UI Host, Recommended)`

## Extension Settings

This extension contributes the following settings:

- `echora.nodeSpeech.locale`: Preferred locale for dictation.
  Use `auto` to follow VS Code UI language, or set values such as `zh-CN` or `en-US`.
- `echora.stt.sessionDurationMs`: Maximum duration (ms) for a voice input session.
- `echora.pipeline.textConsumer`: Text consumer backend (`agent-sdk` or `mock`).
- `echora.pipeline.remote`: **[Experimental]** Remote bridge configuration (`wsl:<distro>` or `ssh:<host>`). Leave empty to run locally.
- `echora.pipeline.enableTextEditingBeforeSend`: When `true`, final voice transcription pauses in sidebar for manual review/edit and only sends after explicit user action. Default is `false` (auto-send).

## Known Issues

- WSL Workspace Host does not run the voice pipeline (`extensionKind: ["ui"]` keeps it in UI Host).
  - If VS Code Speech target does not match the current host target, runtime target mismatch errors will occur.
- In `Windows + WSL UNC path + UI Extension Host` debugging, custom Activity Bar file icons (`viewsContainers.activitybar.icon` with SVG/PNG path) may fail to render.
  - Workaround: use built-in codicons (for example `$(mic)`) for the Activity Bar icon in this environment.

## Release Notes

Check [CHANGELOG.md](CHANGELOG.md).
