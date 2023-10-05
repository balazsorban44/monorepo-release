import type { PackageJson } from "type-fest"
import { gray, blue, red, magenta, bold } from "yoctocolors"
import fs from "node:fs/promises"
import path from "node:path"
import { execSync as nodeExecSync } from "node:child_process"
import { Config, defaultConfig } from "./config.js"

async function read(
	directory: string,
): Promise<Required<PackageJson & { release?: Partial<Config> }>> {
	const content = await fs.readFile(
		path.join(process.cwd(), directory, "package.json"),
		"utf8",
	)
	return JSON.parse(content)
}

async function update(
	directory: string,
	data: Partial<PackageJson>,
): Promise<void> {
	const original = await pkgJson.read(directory)
	const content = JSON.stringify({ ...original, ...data }, null, 2)
	await fs.writeFile(
		path.join(process.cwd(), directory, "package.json"),
		content,
		"utf8",
	)
}

export const pkgJson = { read, update }

function purpleNumber(args: any[]) {
	return args.map((a) =>
		typeof a === "number" ? bold(magenta(a.toString())) : a,
	)
}

export const log = {
	debug(...args) {
		if (!defaultConfig.verbose) return
		const [first, ...rest] = purpleNumber(args)
		console.log(gray("[debug]"), `${first}\n${rest.join("\n")}`.trim())
	},
	info(...args) {
		if (defaultConfig.peek) return
		console.log(blue("[info]"), ...purpleNumber(args))
	},
	/** Runs even if `config.peek` is set */
	peekInfo(...args) {
		console.log(args.join("\n"))
	},
	error(error: Error) {
		console.error(red("\n[error]"), error, "\n")
	},
}

export function execSync(...args: Parameters<typeof nodeExecSync>) {
	return nodeExecSync(args[0], { stdio: "inherit", ...args[1] })
}

export function pluralize(
	word: string,
	count: number | Array<any> | Set<any> | Map<any, any>,
) {
	const pluralRules = new Intl.PluralRules("en", { type: "cardinal" })
	count =
		typeof count === "number"
			? count
			: count instanceof Set || count instanceof Map
			? count.size
			: count.length

	const pluralForm = pluralRules.select(count)
	switch (pluralForm) {
		case "one":
			return word
		case "other":
			return word + "s" // simple pluralization, may need adjustment based on the word
		default:
			return word
	}
}
