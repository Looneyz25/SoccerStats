const FUNCTION_URL =
  process.env.STRIPE_FUNCTION_URL ||
  'https://australia-southeast1-sports-predictions-f91fd.cloudfunctions.net/stripeApi';

export async function POST(request) {
  const signature = request.headers.get('stripe-signature') || '';
  const body = await request.text();
  const upstream = await fetch(`${FUNCTION_URL}/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature,
    },
    body,
  });
  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
