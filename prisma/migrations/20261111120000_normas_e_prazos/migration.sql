-- Enquadramento legal da estrutura
ALTER TABLE "Installation" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'BR';
ALTER TABLE "Installation" ADD COLUMN "uf" TEXT;
ALTER TABLE "Installation" ADD COLUMN "inPnsb" BOOLEAN;
ALTER TABLE "Installation" ADD COLUMN "criClassification" TEXT;
ALTER TABLE "Installation" ADD COLUMN "constructionMethod" TEXT;
ALTER TABLE "Installation" ADD COLUMN "gistmConsequence" TEXT;
ALTER TABLE "Installation" ADD COLUMN "zasCommunity" BOOLEAN;

-- CreateTable
CREATE TABLE "LegalCheck" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "obligationCode" TEXT NOT NULL,
    "aiStatus" TEXT,
    "aiJustification" TEXT,
    "aiDocumentId" TEXT,
    "aiExcerpt" TEXT,
    "aiAt" TIMESTAMP(3),
    "finalStatus" TEXT,
    "finalNote" TEXT,
    "lastDoneAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalCheck_installationId_obligationCode_key" ON "LegalCheck"("installationId", "obligationCode");
CREATE INDEX "LegalCheck_installationId_idx" ON "LegalCheck"("installationId");

ALTER TABLE "LegalCheck" ADD CONSTRAINT "LegalCheck_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mesmo isolamento por organização das demais tabelas da instalação.
ALTER TABLE "LegalCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalCheck" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_check_tenant ON "LegalCheck";
CREATE POLICY legal_check_tenant ON "LegalCheck"
  FOR ALL
  USING (
    app_rls_open()
    OR EXISTS (
      SELECT 1 FROM "Installation" i
      WHERE i.id = "LegalCheck"."installationId" AND i."organizationId" = app_current_org_id()
    )
  )
  WITH CHECK (
    app_rls_open()
    OR EXISTS (
      SELECT 1 FROM "Installation" i
      WHERE i.id = "LegalCheck"."installationId" AND i."organizationId" = app_current_org_id()
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gistm_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LegalCheck" TO gistm_app;
  END IF;
END $$;

-- Títulos e nomes de arquivo que ficaram com o caminho do Windows
-- (importações antigas): o título vira o nome do arquivo, sem pasta e sem extensão.
UPDATE "DocumentFile"
SET "fileName" = regexp_replace("fileName", '^.*[\\/]', '')
WHERE "fileName" ~ '[\\/].';

UPDATE "DocumentFile"
SET "title" = regexp_replace("fileName", '\.[^.]+$', '')
WHERE position('\' in "title") > 0 AND "fileName" <> '';
