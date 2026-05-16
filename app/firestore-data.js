import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import { getFirebaseDb } from './firebase';

const DASHBOARD_DOC = 'match_data';

export async function loadMatchDataFromFirestore() {
  const db = getFirebaseDb();
  const metaRef = doc(db, 'dashboardData', DASHBOARD_DOC);
  const metaSnap = await getDoc(metaRef);

  if (!metaSnap.exists()) {
    throw new Error('Firestore match data metadata not found');
  }

  const meta = metaSnap.data();
  const chunksRef = collection(db, 'dashboardData', DASHBOARD_DOC, 'chunks');
  const chunksSnap = await getDocs(query(chunksRef, orderBy('index', 'asc')));
  const chunks = chunksSnap.docs.map((chunkDoc) => chunkDoc.data()?.text || '');

  if (!chunks.length || chunks.length !== meta.chunkCount) {
    throw new Error('Firestore match data chunks are incomplete');
  }

  return JSON.parse(chunks.join(''));
}
