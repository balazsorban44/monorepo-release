import { defaultConfig } from "./config.js"
import { shouldSkip } from "./skip.js"
import { verify as verify } from "./verify.js"
import { analyze } from "./analyze.js"
import { publish } from "./publish.js"
import { debug } from "./utils.js"

const userConfig = {} // TODO: Allow user config

const config = { ...defaultConfig, userConfig }
if (config.dryRun) {
	console.log("\nPerforming dry run, no packages will be published!\n")
}

if (shouldSkip({ releaseBranches: config.releaseBranches })) {
	process.exit(0)
}

if (config.dryRun) {
	console.log("\nDry run, skip validation...\n")
} else {
	!config.NO_VERIFY && (await verify())
}

const packages = await analyze(defaultConfig)

if (!packages.length) process.exit(0)

debug(
	"Packages to release:",
	packages
		.map((p) =>
			JSON.stringify(
				{
					...p,
					commits: `${p.commits.features.length} feature(s), ${p.commits.bugfixes.length} bugfixe(s), ${p.commits.other.length} other(s) and ${p.commits.breaking.length} breaking change(s)`,
				},
				null,
				2
			)
		)
		.join("\n")
)

await publish(packages, config)
