/**
 * Build the cockpit URL for a chat. Prefers the slug (human-readable)
 * and falls back to the ULID for legacy rows or any chat where the
 * daemon's backfill couldn't generate a slug.
 *
 * Use this for every `<Link href>` and `router.push` that targets a
 * run page so URLs stay consistent. Daemon's slug-or-id resolver
 * makes both forms work either way; this is purely about which one
 * we display.
 */
export function chatHref(chat: { id: string; slug?: string | null }): string {
  return `/runs/${chat.slug || chat.id}`;
}
