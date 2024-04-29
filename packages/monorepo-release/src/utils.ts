import type { PackageJson } from "type-fest"
import { gray, blue, red, magenta, bold } from "yoctocolors"
import fs from "node:fs/promises"
import path from "node:path"
import { execSync as nodeExecSync } from "node:child_process"
import { Readable } from "node:stream"
import { Config, defaultConfig } from "./config.js"

type PackageJsonRelease = PackageJson & { release: Partial<Config> }

async function read(directory: string): Promise<PackageJsonRelease>
async function read(directory: string, raw: true): Promise<string>
async function read(
  directory: string,
  raw?: boolean,
): Promise<PackageJsonRelease | string> {
  const content = await fs.readFile(
    path.join(process.cwd(), directory, "package.json"),
    "utf8",
  )
  return raw ? content : JSON.parse(content)
}

async function update(
  directory: string,
  data: Partial<PackageJson>,
): Promise<void> {
  const original = await pkgJson.read(directory, true)
  let content = JSON.stringify({ ...JSON.parse(original), ...data }, null, 2)
  content += original.endsWith("\r\n") ? "\r\n" : "\n"
  await fs.writeFile(
    path.join(process.cwd(), directory, "package.json"),
    content,
  )
}

export const pkgJson = { read, update }

function purpleNumber(args: any[]) {
  return args.map((a) =>
    typeof a === "number" ? bold(magenta(a.toString())) : a,
  )
}

export const log = {
  debug(...args: any[]) {
    if (!defaultConfig.verbose) return
    const [first, ...rest] = purpleNumber(args)
    console.log(gray("[debug]"), `${first}\n${rest.join("\n")}`.trim())
  },
  info(...args: any[]) {
    if (defaultConfig.peek) return
    console.log(blue("[info]"), ...purpleNumber(args))
  },
  /** Runs even if `config.peek` is set */
  peekInfo(...args: any[]) {
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

export function streamToArray(stream: Readable): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const arr: any[] = []
    stream.on("data", (d) => arr.push(d))
    stream.on("end", () => resolve(arr))
    stream.on("error", reject)
  })
}
