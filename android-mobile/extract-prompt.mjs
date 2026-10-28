// Upstream's baseline also assumes tool calls; the Android chat does not offer them.
import { UNIVERSAL_BASELINE } from '../src/bot/brain/promptLibrary.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const text = UNIVERSAL_BASELINE.replace('When the user mentions self-harm or suicidal thoughts, immediately call safety() to end the conversation.', 'If the user mentions self-harm or suicidal thoughts, respond supportively and encourage immediate help from a trusted person or emergency services when appropriate.');
mkdirSync(new URL('./app/src/main/assets/', import.meta.url), { recursive: true });
writeFileSync(new URL('./app/src/main/assets/baseline.txt', import.meta.url), text + '\n\nAndroid surface: Solphivia × SEI, a community prototype. Reply naturally in the user’s language. The app has written chat, an offline tic-tac-toe board opened with the Gioca a tris button, and turn-based voice opened with Parla / call. You cannot press those buttons, observe the board, control the phone, or access games or memories outside the provided conversation. You have no tools. Do not claim this app is an official SEI release or a full desktop port.');
