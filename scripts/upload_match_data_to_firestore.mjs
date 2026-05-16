import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'sports-predictions-f91fd';
const DOC_ID = 'match_data';
const CHUNK_SIZE = 700_000;

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
