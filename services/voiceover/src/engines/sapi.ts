import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { LibraryVoice } from "../voices.js";
import type { TtsEngine } from "./types.js";

const execFileAsync = promisify(execFile);

// Full path rather than a bare name: the render VM and CI shells don't always
// have System32 on PATH, and this binary is always here on Windows.
const POWERSHELL = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

/** Wrap a string as a PowerShell single-quoted literal (doubling embedded quotes). */
function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The offline fallback engine: Windows System.Speech (SAPI). No network, no key,
 * always available on Windows — which is exactly why it exists. The neural Edge
 * voices are the real library; this is the "the pipeline still produces a
 * voiceover when Edge is unreachable" safety net, and the engine the tests can
 * always run to generate genuine audio.
 */
export class SapiEngine implements TtsEngine {
  readonly kind = "sapi" as const;

  async probe(): Promise<boolean> {
    if (process.platform !== "win32") return false;
    try {
      const { stdout } = await execFileAsync(POWERSHELL, [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices().Count",
      ]);
      return Number.parseInt(stdout.trim(), 10) > 0;
    } catch {
      return false;
    }
  }

  async synthesize(text: string, voice: LibraryVoice, outputPath: string): Promise<void> {
    // Pass the narration via a file, never inline: a segment is hundreds of
    // words and may contain any punctuation, which is impossible to quote safely
    // on a command line.
    const textPath = `${outputPath}.txt`;
    await writeFile(textPath, text, "utf8");

    const hint = voice.systemName ?? (voice.gender === "female" ? "Zira" : "David");
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      // Prefer a voice whose name contains the hint; if none matches, fall back
      // to the first voice of the right gender, then to whatever is installed.
      `$hint = ${psLiteral(hint)}`,
      `$want = ${psLiteral(voice.gender === "female" ? "Female" : "Male")}`,
      "$voices = $s.GetInstalledVoices() | Where-Object { $_.Enabled }",
      "$pick = $voices | Where-Object { $_.VoiceInfo.Name -like ('*' + $hint + '*') } | Select-Object -First 1",
      "if (-not $pick) { $pick = $voices | Where-Object { $_.VoiceInfo.Gender -eq $want } | Select-Object -First 1 }",
      "if (-not $pick) { $pick = $voices | Select-Object -First 1 }",
      "if (-not $pick) { throw 'No System.Speech voices are installed' }",
      "$s.SelectVoice($pick.VoiceInfo.Name)",
      `$s.SetOutputToWaveFile(${psLiteral(outputPath)})`,
      `$text = [System.IO.File]::ReadAllText(${psLiteral(textPath)}, [System.Text.Encoding]::UTF8)`,
      "$s.Speak($text)",
      "$s.Dispose()",
    ].join("; ");

    try {
      await execFileAsync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      throw new Error(`SAPI synthesis failed for voice "${hint}":\n${stderr}`);
    }
  }
}
