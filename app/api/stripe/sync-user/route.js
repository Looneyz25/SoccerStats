const FUNCTION_URL =
  process.env.STRIPE_FUNCTION_URL ||
  'https://australia-southeast1-sports-predictions-f91fd.cloudfunctions.net/stripeApi';

export async function POST(request) {
  const authorization = request.headers.get('authorization') || '';
  const body = await request.text();
  const upstream = await fetch(`${FUNCTION_URL}/sync-user`, {
    method: 'POST',
    headers: {
      authorization,
      'Content-Type': 'application/json',
    },
    body,
  });
  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
