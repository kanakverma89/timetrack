import type { TimeEntry } from '../../api/types';
import { longDate } from '../../utils/dates';

/**
 * Turn the server's `field_errors` for a failed submission into readable lines.
 *
 *   entries.<entry id>.<field>  -> "PRJ-001 on Monday, October 19: …"
 *   day.<YYYY-MM-DD>            -> "Monday, October 19: …"
 *   week / entries / other      -> the message as is
 */
export function describeSubmitErrors(
  fieldErrors: Record<string, string>,
  entries: TimeEntry[],
): string[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const lines: string[] = [];
  for (const [key, message] of Object.entries(fieldErrors)) {
    const entryMatch = /^entries\.([^.]+)\.\w+$/.exec(key);
    const dayMatch = /^day\.(\d{4}-\d{2}-\d{2})$/.exec(key);
    const entry = entryMatch ? byId.get(entryMatch[1] as string) : undefined;
    if (entry) lines.push(`${entry.project.code} on ${longDate(entry.work_date)}: ${message}`);
    else if (dayMatch) lines.push(`${longDate(dayMatch[1] as string)}: ${message}`);
    else lines.push(message);
  }
  return lines;
}
