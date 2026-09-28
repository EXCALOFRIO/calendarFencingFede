-- M7: la categoría de los más pequeños en las ligas autonómicas.
--
-- Sin ella, 24 pruebas se quedaban en cuarentena con «la categoría de una
-- prueba, valor que no reconocemos», o sea fuera del calendario. Se añade
-- DELANTE de M9 porque el orden del enum es el orden en que se ofrecen las
-- categorías en los selectores, y M7 va antes que M9.
--
-- `BEFORE` en lugar de `ADD VALUE` a secas: añadir al final dejaría M7
-- después de VET y los desplegables lo pondrían al final de la lista.
ALTER TYPE "category_code" ADD VALUE IF NOT EXISTS 'M7' BEFORE 'M9';
