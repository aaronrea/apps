/* Showtime — the list of films at Lakewood Ranch, read from the file the
 * workflow commits (showtime/data/movies.json). Each links to its page on
 * filmsociety.org. */

import { loadMovies, fmtAge } from './movies.js';

const list = document.getElementById('films');
const meta = document.getElementById('meta');

function message(text) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  list.replaceChildren(li);
}

try {
  const data = await loadMovies('./data/movies.json');
  if (!data.films.length) {
    message('Nothing listed right now');
  } else {
    list.replaceChildren(...data.films.map((film) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = film.url;
      a.textContent = film.title;
      li.append(a);
      return li;
    }));
  }
  meta.textContent = `Updated ${fmtAge(data.updated)} · filmsociety.org`;
} catch (err) {
  message('Could not load movies');
  meta.textContent = err.message;
}
