const FUNCTION_URL =
  process.env.STRIPE_FUNCTION_URL ||
  'https://australia-southeast1-sports-predictions-f91fd.cloudfunctions.net/stripeApi';

export async function POST(request) {
  const authorization = request.headers.get('authorization') || '';
  const upstream = await fetch(`${FUNCTION_URL}/create-portal`, {
    method: 'POST',
    headers: { authorization },
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
