import { type Profile, profileSchema } from "../../shared/profile.ts";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { redact } from "../files/redact.ts";
import { readPrivateJson, writePrivateJson } from "../tutor-folder.ts";

const profileFile = "profile.json";

export async function readProfile(root: string) {
  const read = await readPrivateJson(root, profileFile, profileSchema);
  return read.ok ? read.value : null;
}

export function writeProfile(root: string, profile: Profile) {
  return writePrivateJson(root, profileFile, profile);
}

export function profileContext(profile: Profile) {
  const level = `The learner's experience level is ${profile.level}. Pitch the explanation for that level.`;
  return profile.goal === null
    ? level
    : `${level}\nWhat the learner wants to do with this repo:\n${wrapUntrusted("goal", redact(profile.goal))}`;
}
