/**
 * src/router.ts — client-side routing over real paths (SPA shell).
 *
 * Paths:
 *   /                         home
 *   /search?q=…               search
 *   /my                       My Learning
 *   /more                     More
 *   /courses/<id>             course page
 *   /courses/<id>/<lessonId>  lesson page
 *   /teachers                 teachers index
 *   /teachers/<slug>          teacher page
 *
 * Legacy website params on /courses/ still work: ?teacher=<slug>, ?topic=<t>,
 * ?q=<text> are read and mapped to the new filters/search (docs/redirects.md).
 *
 * The SPA host serves index.html for any path, so routing is parsed here from
 * location.pathname. `?lang=` is preserved across navigations by src/lang.ts.
 */

export type Route =
  | { name: 'home' }
  | { name: 'search'; q: string }
  | { name: 'my' }
  | { name: 'more' }
  | { name: 'teachers' }
  | { name: 'teacher'; slug: string }
  | { name: 'course'; id: string; topic?: string }
  | { name: 'lesson'; id: string; lessonId: string }
  | { name: 'notfound' };

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'home' };

  switch (parts[0]) {
    case 'search':
      return { name: 'search', q: params.get('q') ?? '' };
    case 'my':
      return { name: 'my' };
    case 'more':
      return { name: 'more' };
    case 'teachers':
      return parts[1] ? { name: 'teacher', slug: decodeURIComponent(parts[1]) } : { name: 'teachers' };
    case 'courses': {
      if (parts[1]) {
        if (parts[2]) return { name: 'lesson', id: parts[1], lessonId: decodeURIComponent(parts[2]) };
        return { name: 'course', id: parts[1] };
      }
      // Legacy /courses/?teacher= ?topic= ?q=
      const q = params.get('q');
      if (q) return { name: 'search', q };
      const teacher = params.get('teacher');
      if (teacher) return { name: 'teacher', slug: teacher };
      // topic filter lands on home with the chip pre-selected (handled by caller).
      return { name: 'home' };
    }
    default:
      return { name: 'notfound' };
  }
}

/** Build the path for a route (used by links and the address display). */
export function routePath(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'search':
      return route.q ? `/search?q=${encodeURIComponent(route.q)}` : '/search';
    case 'my':
      return '/my';
    case 'more':
      return '/more';
    case 'teachers':
      return '/teachers';
    case 'teacher':
      return `/teachers/${encodeURIComponent(route.slug)}`;
    case 'course':
      return `/courses/${route.id}`;
    case 'lesson':
      return `/courses/${route.id}/${encodeURIComponent(route.lessonId)}`;
    default:
      return '/';
  }
}

/** Which bottom tab is active for a route. */
export function tabForRoute(route: Route): 'home' | 'search' | 'my' | 'more' {
  if (route.name === 'search') return 'search';
  if (route.name === 'my') return 'my';
  if (route.name === 'more') return 'more';
  return 'home'; // home, course, lesson, teacher(s), notfound
}
