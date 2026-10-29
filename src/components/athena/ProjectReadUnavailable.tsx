export function ProjectReadUnavailable() {
  return (
    <main style={{ maxWidth: 520, margin: "15vh auto", padding: 32, color: "#183453" }}>
      <h1 style={{ fontSize: 24 }}>This project is currently unavailable</h1>
      <p role="alert">
        You are signed in, but Athena could not open this project. Try again. If it still does not
        open, ask your company owner to check your access.
      </p>
      <button type="button" onClick={() => window.location.reload()}>
        Try again
      </button>
      <p>
        <a href="/account">Back to your account</a>
      </p>
    </main>
  );
}
