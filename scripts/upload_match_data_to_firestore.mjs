import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'sports-predictions-f91fd';
const DOC_ID = 'match_data';
const CHUNK_SIZE = 700_000;
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(ROOT, '.secrets', 'firebase-service-account.json');

function applyLocalEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex < 1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function loadLocalCredentials() {
  applyLocalEnvFile(path.join(ROOT, '.env.local'));
  applyLocalEnvFile(path.join(ROOT, '.env'));

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(DEFAULT_SERVICE_ACCOUNT_PATH)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_SERVICE_ACCOUNT_PATH;
  }
}

function credentialOptions() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    return {
      projectId: PROJECT_ID,
      credential: cert(JSON.parse(serviceAccountJson)),
    };
  }

  return {
    projectId: PROJECT_ID,
    credential: applicationDefault(),
  };
}

async function main() {
  loadLocalCredentials();

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Firestore upload needs credentials.');
    console.error('Use one of these local admin credential options:');
    console.error(`1. Save the service account JSON at ${DEFAULT_SERVICE_ACCOUNT_PATH}`);
    console.error('2. Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file path in .env.local');
    console.error('3. Set FIREBASE_SERVICE_ACCOUNT_JSON to the service account JSON string in .env.local');
    process.exit(1);
  }

  const dataPath = path.join(ROOT, 'match_data.json');
  const raw = await readFile(dataPath, 'utf8');
  const parsed = JSON.parse(raw);
  const chunks = [];

  for (let index = 0; index < raw.length; index += CHUNK_SIZE) {
    chunks.push(raw.slice(index, index + CHUNK_SIZE));
  }

  if (!getApps().length) {
    initializeApp(credentialOptions());
  }

  const db = getFirestore();
  const metaRef = db.collection('dashboardData').doc(DOC_ID);
  const chunksRef = metaRef.collection('chunks');
  const existing = await chunksRef.listDocuments();
  const writer = db.bulkWriter();

  for (const ref of existing) {
    writer.delete(ref);
  }

  chunks.forEach((text, index) => {
    writer.set(chunksRef.doc(String(index).padStart(4, '0')), {
      index,
      text,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  writer.set(metaRef, {
    capturedAt: parsed.captured_at || null,
    source: parsed.source || null,
    leagueCount: Array.isArray(parsed.leagues) ? parsed.leagues.length : 0,
    chunkCount: chunks.length,
    byteLength: Buffer.byteLength(raw),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writer.close();
  console.log(`Uploaded ${dataPath} to Firestore dashboardData/${DOC_ID} in ${chunks.length} chunks.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
