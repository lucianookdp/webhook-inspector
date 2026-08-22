import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ID_LENGTH = 12;

export function generateId(): string {
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ALPHABET[randomInt(ALPHABET.length)];
  }
  return id;
}
