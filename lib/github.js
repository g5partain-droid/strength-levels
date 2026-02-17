/**
 * Create a GitHub Issue
 */
async function createIssue(title, body, labels = []) {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body, labels }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    console.error("GitHub createIssue error:", data);
    throw new Error(`GitHub API error: ${data.message}`);
  }
  return data;
}

module.exports = { createIssue };
