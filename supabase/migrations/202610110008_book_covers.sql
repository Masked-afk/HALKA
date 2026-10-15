-- Optional private cover image path for book posts.
alter table public.posts
  add column if not exists cover_path text;

alter table public.posts
  drop constraint if exists posts_book_cover_path_valid,
  add constraint posts_book_cover_path_valid
    check (
      cover_path is null
      or (
        kind is not null
        and kind = 'book'
        and author_id is not null
        and length(cover_path) <= 500
        and cover_path like author_id::text || '/book-covers/%'
      )
    );

notify pgrst, 'reload schema';
