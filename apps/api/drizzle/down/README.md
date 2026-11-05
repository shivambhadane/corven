Drizzle Kit does not generate down migrations. These scripts reverse the
corresponding up migrations by hand. Apply newest first. They destroy data;
never run them against a database whose audit history matters.
