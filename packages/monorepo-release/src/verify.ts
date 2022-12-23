export async function verify() {
	if (!process.env.NPM_TOKEN) {
		throw new Error("NPM_TOKEN is not set")
	}
	if (!process.env.RELEASE_TOKEN) {
		throw new Error("RELEASE_TOKEN is not set")
	}
}
