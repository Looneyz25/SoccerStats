export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-field px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">This page is not available in the predictions dashboard.</p>
        <a
          href="/"
          className="mt-4 inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink shadow-panel hover:bg-field"
        >
          Back to matches
        </a>
      </div>
    </main>
  );
}
