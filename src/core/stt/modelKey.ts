import { createDecipheriv, createHash } from 'crypto';

const NODE_SPEECH_DEFAULT_MODEL_NAME = 'Microsoft Speech Recognizer en-US FP Model V9';

export function deriveNodeSpeechModelName(distCode: string): string {
	const sttModelMatch = distCode.match(
		/modelName:\"([^\"]+)\",modelPath:\(0,[^)]+\)\(__dirname,\"\.\.\",\"assets\",\"stt\"\)/
	);
	return sttModelMatch?.[1] ?? NODE_SPEECH_DEFAULT_MODEL_NAME;
}

export function deriveNodeSpeechModelKey(distCode: string): string {
	const licenseTextMatch = distCode.match(/\"(You may only use the C\/C\+\+ Extension[^\"]+)\"/);
	if (!licenseTextMatch) {
		throw new Error('Unable to parse VS Code Speech license text for model key derivation.');
	}

	const licenseText = decodeQuotedString(licenseTextMatch[1]);
	const hexMatches = [...distCode.matchAll(/Buffer\.from\(\"([0-9a-f]+)\",\"hex\"\)/g)].map(
		(match) => match[1]
	);
	const tagHex = hexMatches.find((value) => value.length === 32);
	const ivHex = hexMatches.find((value) => value.length === 24);
	const cipherHex = hexMatches
		.filter((value) => value.length > 1000)
		.sort((a, b) => b.length - a.length)[0];

	if (!tagHex || !ivHex || !cipherHex) {
		throw new Error('Unable to parse encrypted model key payload from VS Code Speech extension.');
	}

	const hash = createHash('sha256').update(licenseText).digest();
	const decipher = createDecipheriv('aes-256-gcm', hash, Buffer.from(ivHex, 'hex'));
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
	return Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString(
		'utf8'
	);
}

function decodeQuotedString(value: string): string {
	return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`) as string;
}
