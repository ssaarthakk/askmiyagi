import { writeFile } from "node:fs/promises";
import { type Profile, profileSchema } from "../../shared/profile.ts";
import type { Result } from "../../shared/result.ts";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { redact } from "../files/redact.ts";
import { privateFileOrProblem, readPrivateJson } from "../tutor-folder.ts";

const profileFile = "profile.json";

export function readProfile(root: string) {
  return readPrivateJson(root, profileFile, profileSchema);
}

export async function writeProfile(root: string, profile: Profile): Promise<Result<Profile>> {
  try {
    const file = await privateFileOrProblem(root, profileFile);
    if (!file.ok) return file;
    await writeFile(file.value, JSON.stringify(profile, null, 2));
    return { ok: true, value: profile };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function profileContext(profile: Profile) {
  const level = `The learner's experience level is ${profile.level}. Pitch the explanation for that level.`;
  return profile.goal === null
    ? level
    : `${level}\nWhat the learner wants to do with this repo:\n${wrapUntrusted("goal", redact(profile.goal))}`;
}
