# Fiscalização de Obras

App instalável no celular (campo) e no computador (gestão) para acompanhar as obras empenhadas às empreiteiras.

- **App:** este repositório, publicado no GitHub Pages.
- **Dados:** uma planilha Google por divisão, com o Apps Script `Codigo.gs`. As fotos, plantas e PDFs ficam no Drive da mesma conta.
- **Códigos de acesso:** ficam só na aba `chaves` de cada planilha. Nunca vão para este repositório.

---

## Parte 1 · Planilha da divisão (ex.: conta fiscalizacaovcmcep@gmail.com)

1. Entre no Google Planilhas com a conta da divisão e crie uma planilha em branco chamada **Fiscalização VCMCEP · app**.
2. Abra **Extensões → Apps Script**, apague o que estiver lá, cole todo o conteúdo do `Codigo.gs` e clique em **Salvar**.
3. Volte para a planilha e recarregue a página (F5). Vai aparecer o menu **Fiscalização**.
4. Clique em **Fiscalização → 1. Configurar**.
   - O Google pede autorização: **Avançado → Acessar (não seguro)**. Isso é normal para um script próprio.
   - Informe a sigla **VCMCEP** e o prefixo **CEP**.
   - O script cria as abas, a pasta de arquivos no Drive e os dois primeiros códigos: um de gestor e um de fiscal.
5. Na aba **chaves**, inclua uma linha por empreiteira:
   - coluna **papel** = `empreiteira`;
   - coluna **empresa** = o nome exatamente como vai ser digitado no empenho (ex.: `Serpa`);
   - depois clique em **Fiscalização → 2. Gerar códigos que faltam**.
6. Clique em **Implantar → Nova implantação**, escolha o tipo **App da Web** e configure:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
7. Clique em **Implantar** e copie o endereço que termina em **/exec**.

## Parte 2 · Publicar o app no GitHub (uma conta só, para todas as divisões)

1. Crie a conta no GitHub. Conta usada: `fiscalizacaovcm`.
2. Clique em **New repository**, dê o nome `fiscalizacaovcm` e escolha **Public**. Pode ser público porque aqui só fica o código, sem nenhum dado.
3. No `config.js`, cole o endereço /exec na linha da `CEP`.
4. Clique em **Add file → Upload files**, arraste todos os arquivos desta pasta e confirme em **Commit changes**.
5. Vá em **Settings → Pages**. Em Source, escolha **Deploy from a branch**, depois **main** e **/(root)**, e clique em **Save**.
6. Em 1 ou 2 minutos o app estará em `https://fiscalizacaovcm.github.io/fiscalizacaovcm/`.

## Parte 3 · Usar

- **Gestão (computador):** abra o link, entre com o código de **gestor** e use **Empenhar obra** para subir o PDF do projeto.
- **Campo (celular):** abra o link no **Chrome** (Android) ou no **Safari** (iPhone) e entre com o código da empreiteira.
  - Android: toque em **Instalar**.
  - iPhone: toque em **Compartilhar → Adicionar à Tela de Início**.
  - Permita **localização** e **câmera** quando o celular pedir.
- **Sem sinal:** o registro fica guardado no celular e é enviado sozinho quando o sinal volta.
- **Bloquear um código:** na aba `chaves`, mude a coluna **ativa** para `NÃO`.

## Atualizar

- **App:** suba os arquivos novos no repositório e troque `VERSAO` no `sw.js` (ex.: `v2`) para os celulares baixarem a versão nova.
- **Script da planilha:** cole o código novo e use **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar**.
  - **Nunca** use "Nova implantação" de novo, porque o endereço muda e o app perde a conexão.

## Adicionar outra divisão (VCMSUL, VCMMSL, VCMCMN)

1. Na conta Gmail da divisão, repita a **Parte 1** com a sigla e o prefixo dela:
   - VCMSUL → `SUL`
   - VCMMSL → `MSL`
   - VCMCMN → `CMN`
2. Cole o endereço /exec dela no `config.js` e suba só esse arquivo no GitHub.
3. O gestor que tiver códigos de mais de uma divisão pode conectar todas em **Conta → + Conectar outra divisão** e ver a regional somada no painel.

## Observações

- Os arquivos (plantas, fotos e PDFs) ficam no Drive da divisão, compartilhados **só por link**. Quem não tem o link não encontra os arquivos.
- O app lê automaticamente os postes numerados dos PDFs do GEO. Se algum PDF vier como imagem (escaneado), os postes são marcados à mão na tela de conferência.
- As US executadas são estimadas proporcionalmente aos postes executados.
