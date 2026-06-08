const FUNCTION_URL =
  process.env.STRIPE_FUNCTION_URL ||
  'https://australia-southeast1-sports-predictions-f91fd.cloudfunctions.net/stripeApi';

export async function POST(request) {
  const authorization = request.headers.get('authorization') || '';
  const body = await request.text();
  try {
    const upstream = await fetch(`${FUNCTION_URL}/sync-user`, {
      method: 'POST',
      headers: {
        authorization,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return Response.json(
      { error: timedOut ? 'Stripe sync timed out. Try again shortly.' : 'Stripe sync failed.' },
      { status: timedOut ? 504 : 502 }
    );
  }
}
