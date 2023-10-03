import { defaultConfig } from "./config.js"
import { shouldSkip } from "./skip.js"
import { analyze } from "./analyze.js"
import { publish } from "./publish.js"
import { log } from "./utils.js"
import { bold, green } from "yoctocolors"

const userConfig = {} // TODO: Allow user config
const config = { ...defaultConfig, ...userConfig }

if (config.dryRun) {
	log.info(bold(green("Performing dry run, no packages will be released!\n")))
} else {
	log.info(bold(green("Let's release some packages!\n")))
}

log.debug("Configuration:", JSON.stringify(config, null, 2))

if (shouldSkip({ releaseBranches: config.releaseBranches })) {
	process.exit(0)
}

if (config.dryRun) {
	log.debug("Dry run, skipping token validation...\n")
} else if (config.noVerify) {
	log.info("--no-verify or NO_VERIFY set, skipping token validation...\n")
} else {
	if (!process.env.NPM_TOKEN) throw new Error("NPM_TOKEN is not set")
	if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not set")
}

const packages = await analyze(defaultConfig)

log.debug(
	"Packages to release:",
	packages
		.map((p) =>
			JSON.stringify(
				{
					...p,
					commits: `${p.commits.features.length} feature(s), ${p.commits.bugfixes.length} bugfixe(s), ${p.commits.other.length} other(s) and ${p.commits.breaking.length} breaking change(s)`,
				},
				null,
				2,
			),
		)
		.join("\n"),
)

await publish(packages, config)
