# echora README

Echora is a VS Code extension that empowers your CLI agent with STT/TTS and makes it your best companion — chatting, learning, and working, always echoing to you.

## Features

- NodeSpeech voice input (`@vscode/node-speech`): Local Hosted STT AI. Multi-language recognition Supported. 
  - Realtime STT
  - VAD

## Requirements

- VS Code Desktop `>= 1.85`
- `ms-vscode.vscode-speech` installed in the current profile
- OS-level microphone permission granted for VS Code
- For debugging, use launch config: `Run Extension (UI Host, Recommended)`

## Extension Settings

This extension contributes the following settings:

- `echora.nodeSpeech.locale`: Preferred locale for dictation.  
  Use `auto` to follow VS Code UI language, or set values such as `zh-CN` or `en-US`.

## Known Issues

- WSL Workspace Host does not run the voice pipeline (`extensionKind: ["ui"]` keeps it in UI Host).
  - If VS Code Speech target does not match the current host target, runtime target mismatch errors will occur.

## Release Notes

Check [CHANGELOG.md](CHANGELOG.md).
