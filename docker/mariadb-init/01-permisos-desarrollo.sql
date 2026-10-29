-- Solo para el entorno de desarrollo con Docker.
-- `prisma migrate dev` necesita crear una base temporal ("shadow database") y los tests
-- usan bases aparte (pedila_test, pedila_e2e): por eso el usuario de desarrollo tiene
-- permisos amplios. En producción el usuario de la app solo tiene permisos sobre su base.
GRANT ALL PRIVILEGES ON *.* TO 'pedila'@'%';
FLUSH PRIVILEGES;
