import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROJECT_ID = 'sports-predictions-f91fd';
const ADMIN_GROUPS_DOC = 'admin_user_groups';
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(process.cwd(), '.secrets', 'firebase-service-account.json');
const OWNER_EMAIL = 'l.vorabouth@gmail.com';

let adminApp = null;

function getAdminApp() {
  if (adminApp) return adminApp;
  if (getApps().length) {
    adminApp = getApps()[0];
    return adminApp;
  }
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!serviceAccountJson && !process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(DEFAULT_SERVICE_ACCOUNT_PATH)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = DEFAULT_SERVICE_ACCOUNT_PATH;
  }
  const credential = serviceAccountJson ? cert(JSON.parse(serviceAccountJson)) : applicationDefault();
  adminApp = initializeApp({ projectId: PROJECT_ID, credential });
  return adminApp;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function verifyOwner(request) {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('missing-token'), { status: 401 });

  const decoded = await getAuth(getAdminApp()).verifyIdToken(match[1]);
  if (decoded.email === OWNER_EMAIL) return decoded;

  const snap = await getFirestore(getAdminApp()).collection('users').doc(decoded.uid).get();
  if (!snap.exists || !snap.get('isPlatformOwner')) {
    throw Object.assign(new Error('platform-owner-required'), { status: 403 });
  }
  return decoded;
}

function sanitizeConfig(config) {
  const rawGroups = Array.isArray(config?.groups) ? config.groups : [];
  const groups = [...new Set(
    rawGroups
      .map((name) => String(name || '').trim())
      .filter(Boolean)
      .slice(0, 60),
  )];

  const rawAssignments = config?.assignments && typeof config.assignments === 'object' ? config.assignments : {};
  const assignments = {};
  Object.entries(rawAssignments).forEach(([uid, groupList]) => {
    const cleanUid = String(uid || '').trim();
    if (!cleanUid) return;
    const cleanGroups = Array.isArray(groupList)
      ? [...new Set(groupList.map((name) => String(name || '').trim()).filter((name) => groups.includes(name)))]
      : [];
    assignments[cleanUid] = cleanGroups;
  });

  return { groups, assignments };
}

export async function GET(request) {
  try {
    await verifyOwner(request);
    const snap = await getFirestore(getAdminApp()).collection('dashboardData').doc(ADMIN_GROUPS_DOC).get();
    if (!snap.exists) return jsonResponse({ groups: [], assignments: {} });
    return jsonResponse(sanitizeConfig(snap.data() || {}));
  } catch (err) {
    return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401);
  }
}

export async function POST(request) {
  let owner;
  try {
    owner = await verifyOwner(request);
  } catch (err) {
    return jsonResponse({ error: err.message || 'unauthorized' }, err.status || 401);
  }

  try {
    const config = sanitizeConfig(await request.json());
    await getFirestore(getAdminApp()).collection('dashboardData').doc(ADMIN_GROUPS_DOC).set({
      ...config,
      updatedAt: new Date().toISOString(),
      updatedBy: owner.uid,
      updatedByEmail: owner.email || null,
    }, { merge: true });
    return jsonResponse(config);
  } catch (err) {
    return jsonResponse({ error: err.message || 'Failed to save groups.' }, 400);
  }
}
