const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const Stripe = require('stripe');

const PRO_PRICE_ID = 'price_1TXpTJBbsFy1wAkF64nFdG26';
const PRO_PLAN_NAME = 'Soccer Stats Pro';
const PRO_TRIAL_DAYS = 7;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://lvrstats.com';

admin.initializeApp();

let stripeClient;

function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured.');
  }
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2026-02-25.clover',
    });
  }
  return stripeClient;
}

function sendJson(res, status, payload) {
  res.status(status).set('Content-Type', 'application/json').send(JSON.stringify(payload));
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function subscriptionHasAccess(status) {
  return status === 'active' || status === 'trialing';
}

function subscriptionPriceId(subscription) {
  return subscription?.items?.data?.[0]?.price?.id || '';
}

async function verifyUser(req) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error('Sign in before continuing.');
    error.status = 401;
    throw error;
  }
  return admin.auth().verifyIdToken(token);
}

async function findUserRefBySubscription(subscription) {
  const uid = subscription.metadata?.firebaseUid;
  if (uid) return admin.firestore().collection('users').doc(uid);

  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (!customerId) return null;

  const snap = await admin.firestore().collection('users')
    .where('stripeCustomerId', '==', customerId)
    .limit(1)
    .get();

  return snap.empty ? null : snap.docs[0].ref;
}

async function syncSubscription(subscription) {
  const userRef = await findUserRefBySubscription(subscription);
  if (!userRef) {
    console.warn('Could not match Stripe subscription to a Firebase user:', subscription.id);
    return;
  }

  const priceId = subscriptionPriceId(subscription);
  const hasSubscriptionAccess = priceId === PRO_PRICE_ID && subscriptionHasAccess(subscription.status);
  const userSnap = await userRef.get();
  const profile = userSnap.exists ? userSnap.data() : {};
  const hasLegacyManualAccess = profile.hasAccess === true && !String(profile.accessSource || '').startsWith('stripe');
  const hasManualAccess = Boolean(profile.manualAccess || profile.isPlatformOwner || hasLegacyManualAccess);
  const inheritStripeStatus = profile.inheritStripeStatus !== false;
  const inheritsActiveStripe = inheritStripeStatus && hasSubscriptionAccess;
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  await userRef.set({
    hasAccess: hasManualAccess || inheritsActiveStripe,
    inheritStripeStatus,
    subscriptionHasAccess: hasSubscriptionAccess,
    accessSource: hasManualAccess ? 'manual' : inheritsActiveStripe ? 'stripe' : hasSubscriptionAccess ? 'stripe_not_inherited' : 'stripe_inactive',
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || null,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    subscriptionStatus: subscription.status,
    subscriptionCurrentPeriodEnd: periodEnd,
    subscriptionCancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function syncCheckoutSession(session) {
  if (session.mode !== 'subscription') return;

  const uid = session.client_reference_id || session.metadata?.firebaseUid;
  if (!uid) return;

  await admin.firestore().collection('users').doc(uid).set({
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
    stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null,
    checkoutCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  if (session.subscription) {
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const subscription = await stripe().subscriptions.retrieve(subscriptionId);
    await syncSubscription(subscription);
  }
}

async function getOrCreateCustomer(decoded) {
  const db = admin.firestore();
  const userRef = db.collection('users').doc(decoded.uid);
  const userSnap = await userRef.get();
  const profile = userSnap.exists ? userSnap.data() : {};
  const email = decoded.email || profile.email || undefined;

  let customerId = profile.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email,
      name: decoded.name || profile.displayName || undefined,
      metadata: { firebaseUid: decoded.uid },
    });
    customerId = customer.id;
    await userRef.set({
      email: email || '',
      displayName: decoded.name || profile.displayName || '',
      stripeCustomerId: customerId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return customerId;
}

async function createCheckout(req, res) {
  const decoded = await verifyUser(req);
  const customerId = await getOrCreateCustomer(decoded);

  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
    allow_promotion_codes: true,
    payment_method_collection: 'if_required',
    client_reference_id: decoded.uid,
    customer_update: { name: 'auto' },
    metadata: {
      firebaseUid: decoded.uid,
      plan: PRO_PLAN_NAME,
    },
    subscription_data: {
      trial_period_days: PRO_TRIAL_DAYS,
      trial_settings: {
        end_behavior: {
          missing_payment_method: 'cancel',
        },
      },
      metadata: {
        firebaseUid: decoded.uid,
        plan: PRO_PLAN_NAME,
      },
    },
    success_url: `${APP_URL}/dashboard?checkout=success`,
    cancel_url: `${APP_URL}/dashboard?checkout=cancelled`,
  });

  return sendJson(res, 200, { url: session.url });
}

async function createPortal(req, res) {
  const decoded = await verifyUser(req);
  const customerId = await getOrCreateCustomer(decoded);

  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL}/dashboard`,
  });

  return sendJson(res, 200, { url: session.url });
}

async function syncCurrentSubscription(req, res) {
  const decoded = await verifyUser(req);
  const userRef = admin.firestore().collection('users').doc(decoded.uid);
  const userSnap = await userRef.get();
  const profile = userSnap.exists ? userSnap.data() : {};

  if (!profile.stripeCustomerId) {
    return sendJson(res, 200, { synced: false, reason: 'No Stripe customer linked.' });
  }

  const subscriptions = await stripe().subscriptions.list({
    customer: profile.stripeCustomerId,
    status: 'all',
    limit: 10,
  });

  const relevant = subscriptions.data
    .filter((subscription) => subscriptionPriceId(subscription) === PRO_PRICE_ID)
    .sort((a, b) => (b.created || 0) - (a.created || 0))[0];

  if (!relevant) {
    await userRef.set({
      subscriptionHasAccess: false,
      hasAccess: Boolean(profile.manualAccess || profile.isPlatformOwner),
      accessSource: profile.manualAccess ? 'manual' : profile.isPlatformOwner ? 'owner' : 'stripe_inactive',
      subscriptionStatus: 'none',
      subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return sendJson(res, 200, { synced: false, reason: 'No Soccer Stats Pro subscription found.' });
  }

  await syncSubscription(relevant);
  return sendJson(res, 200, {
    synced: true,
    subscriptionStatus: relevant.status,
    subscriptionId: relevant.id,
  });
}

async function webhook(req, res) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return sendJson(res, 500, { error: 'STRIPE_WEBHOOK_SECRET is not configured.' });
  }

  let event;
  try {
    event = stripe().webhooks.constructEvent(req.rawBody, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error.message);
    return sendJson(res, 400, { error: 'Invalid webhook signature.' });
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await syncCheckoutSession(event.data.object);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(event.data.object);
      break;
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
      if (event.data.object.subscription) {
        const subscription = await stripe().subscriptions.retrieve(event.data.object.subscription);
        await syncSubscription(subscription);
      }
      break;
    default:
      break;
  }

  return sendJson(res, 200, { received: true });
}

exports.stripeApi = onRequest({
  region: 'australia-southeast1',
  secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
}, async (req, res) => {
  try {
    const routePath = req.path || req.url || '';
    if (req.method === 'POST' && routePath.endsWith('/create-checkout')) {
      return await createCheckout(req, res);
    }
    if (req.method === 'POST' && routePath.endsWith('/create-portal')) {
      return await createPortal(req, res);
    }
    if (req.method === 'POST' && routePath.endsWith('/sync-subscription')) {
      return await syncCurrentSubscription(req, res);
    }
    if (req.method === 'POST' && routePath.endsWith('/webhook')) {
      return await webhook(req, res);
    }
    return sendJson(res, 404, { error: 'Stripe endpoint not found.' });
  } catch (error) {
    console.error('Stripe API failed:', error);
    return sendJson(res, error.status || 500, { error: error.message || 'Stripe request failed.' });
  }
});
