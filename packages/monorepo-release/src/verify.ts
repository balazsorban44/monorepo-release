export async function verify() {
	if (!process.env.NPM_TOKEN) {
		throw new Error("NPM_TOKEN is not set")
	}
	if (!process.env.GITHUB_TOKEN) {
		throw new Error("GITHUB_TOKEN is not set")
	}
}
