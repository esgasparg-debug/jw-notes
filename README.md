# Editor de Notas — backups do JW Library

Aplicativo Angular para **sincronizar**, **editar** e **mesclar** backups `.jwlibrary` do JW Library:

- **Sincronizar** (ação principal): com um clique, junta os backups de todos os aparelhos que estão no Google Drive num único arquivo, pronto para restaurar.
- **Notas**: criar, editar, excluir, filtrar por texto, etiqueta e publicação.
- **Comentários**: textos digitados nos campos das publicações (respostas de estudo, apostila).
- **Marcações**: mudar cor ou excluir. **Marcadores**: renomear ou excluir. **Etiquetas**: criar, renomear, juntar, excluir.
- **Mesclagem automática** de dois backups, com relatório de conflitos.
- **Abrir e salvar** no dispositivo, no **Google Drive** ou no **OneDrive**. O arquivo novo é salvo, por padrão, na mesma pasta do original.

Tudo é processado localmente (SQLite em WebAssembly). Os arquivos nunca passam por um servidor próprio.

> Aplicativo independente, sem vínculo oficial com o jw.org ou com o JW Library.

## Requisitos

- **Node.js ≥ 22.22, ≥ 24.15 ou ≥ 26** (exigência do Angular 22). Para manter projetos antigos em Node 18, use um gerenciador de versões (ex.: `winget install CoreyButler.NVMforWindows`).
- npm 10+.

```bash
npm install
npm start          # http://localhost:4200
npm test           # Vitest (Node + jsdom)
npm run build      # dist/jw-notes/browser
```

## Arquitetura

```
src/app/
├── core/                       regras de negócio, sem UI
│   ├── jwlibrary/
│   │   ├── archive/            ler/gravar o zip .jwlibrary, manifest, hash e WAL do SQLite
│   │   ├── database/           SqliteDb (wrapper tipado do sql.js) e o carregador do engine
│   │   ├── models/             tipos das tabelas, view models, nomes de livros e publicações
│   │   ├── repositories/       um repositório por agregado (notas, etiquetas, marcações…) + UserData
│   │   ├── merge/              motor de mesclagem (funções puras sobre dois bancos)
│   │   ├── live/               backup direto do banco do JW Library instalado (desktop)
│   │   ├── jw-document.ts      documento aberto (zip + banco + origem)
│   │   └── jwlibrary.service.ts abrir / mesclar
│   ├── storage/                interface StorageProvider + local, Google Drive (DriveApi) e OneDrive
│   ├── sync/                   sincronização: pastas jw-notes no Drive, aparelhos, rodadas, avisos e o fluxo de merge
│   ├── state/                  DocumentStore (signals), ações de abrir/salvar, guard
│   ├── platform/               detecta web / Electron / Android / iOS
│   └── ui/                     serviços de avisos, confirmação e diálogos de arquivo
├── shared/                     componentes, diretivas e pipes reutilizáveis
└── features/                   telas (lazy loading): home + sync, editor/*, merge, settings
```

Fora de `src/`: `desktop/` (Electron, incluindo a leitura e a gravação do banco do JW Library), `mobile/android/` (plugins
nativos, aplicados por `scripts/setup-android.cjs`) e `functions/` (Cloud Function que repassa as notificações).

Princípios usados:

- **Componentes standalone, zoneless e signals**: estado em `DocumentStore`. As telas leem `computed()` e alteram dados só via `store.mutate()`.
- **Camadas**: as telas não conhecem SQL. Os repositórios não conhecem Angular. O motor de merge é uma função pura e testável.
- **Armazenamento plugável**: para suportar outra nuvem, basta implementar `StorageProvider` e registrá-la em `app.config.ts`.
- Nomes de arquivo no padrão do guia de estilo do Angular (2025): `note-editor.ts`, `class NoteEditor`.

## Sincronização entre aparelhos

Na primeira conexão com o Google Drive, o app cria esta estrutura, sem precisar de configuração:

```
Meu Drive/jw-notes/
├── backups/pendente/        ← os aparelhos salvam aqui os backups do JW Library (pasta de entrada)
├── backups/sincronizados/   ← backups já mesclados, guardados por segurança
├── sync/                    ← SEMPRE um único arquivo: o resultado mesclado, para restaurar nos aparelhos
├── config/settings.json     ← configurações compartilhadas por todos os aparelhos
└── config/aparelhos/        ← um <id>.json por aparelho que participa das rodadas (nome, plataforma, token de push)
```

### Rodadas: todos enviam, um mescla, todos atualizam

Os aparelhos com JW Library (Android e computadores com o JW Library para Windows) se cadastram em `config/aparelhos/` ao
conectar. Navegadores só acompanham.

1. Um aparelho envia o backup dele (Android: JW Library › Criar backup › Compartilhar › **Editor de Notas**; computador: botão
   **Enviar backup**, que lê o JW Library sozinho). O arquivo vai para a pasta de entrada marcado com o aparelho que o enviou.
2. Os outros aparelhos recebem a notificação "*Fulano* enviou um backup. Toque para enviar o deste aparelho." e enviam o deles.
3. Quando o último aparelho cadastrado envia, ele mesmo faz a mesclagem (passos abaixo) e todos recebem **Atualização pronta**.
   Se algum aparelho não responder, qualquer um pode tocar em **Mesclar agora**; o atrasado entra na próxima rodada.
4. Cada aparelho atualiza o JW Library com um toque:
   - **computador:** o app grava o banco mesclado direto no `userData.db` do JW Library. Só com o JW Library fechado, e só se ele
     não mudou desde o envio do backup (senão as alterações se perderiam, e o app pede um novo envio). Antes de gravar, guarda
     os arquivos atuais em `%APPDATA%/jw-notes/jwlibrary-backups/`. Backups com mídia de listas de reprodução passam pelo
     restaurar do próprio JW Library, que também copia a mídia;
   - **Android:** o banco do JW Library é privado, então o app entrega o arquivo ao JW Library, que pede para restaurar. O que
     for anotado entre o envio do backup e a restauração se perde: atualize logo depois do aviso.

Um aparelho que ficou fora de uma rodada é convidado a enviar o backup antes de atualizar, para não perder os próprios dados. Um
computador cujo JW Library não mudou recebe a atualização direto.

Para tirar da lista um aparelho que não existe mais, use o **×** ao lado dele no painel de sincronização.

### Notificações (Firebase)

Sem configuração, cada aparelho vê as novidades ao abrir o app. O computador confere o Drive a cada minuto enquanto está aberto e
mostra uma notificação do sistema. Para avisar os celulares na hora, mesmo com o app fechado:

1. No [console do Firebase](https://console.firebase.google.com/), adicione o Firebase ao **mesmo projeto** do Google Cloud do
   login e mude para o plano **Blaze** (a função cabe na cota gratuita, mas o plano exige cartão).
2. Adicione um app Android com o pacote `org.example.jwnotes`, baixe o `google-services.json` e salve em
   `mobile/android/google-services.json`. Ele fica fora do controle de versão, e o `setup-android.cjs` copia para `android/app`.
3. Em `functions/`: copie `.env.example` para `.env` com os IDs dos clientes OAuth (web e Android), rode `npm install` e
   `npx firebase-tools deploy --only functions` (depois de `firebase login` e `firebase use <projeto>`).
4. Copie a URL da função `notify` para `notifyUrl` em `environment.ts` e `environment.prod.ts`.

A função (`functions/notify.js`) não guarda nada e nunca vê backups. Ela confere que o token Google de quem chamou é deste
app, lê os tokens de push em `config/aparelhos/` no Drive dessa mesma pessoa (com o token dela) e repassa uma mensagem fixa
pelo Firebase Cloud Messaging. Testes: `cd functions && npm test`.

A mesclagem (feita pelo último aparelho da rodada, por **Mesclar agora** ou pelo botão **Sincronizar** do cabeçalho):

1. lê o arquivo atual de `sync/` e todos os backups da pasta de entrada;
2. mescla tudo, mantendo a versão mais recente de cada item;
3. grava o resultado **no mesmo arquivo** de `sync/` (o nome recebe a data; o Google Drive guarda as versões anteriores);
4. move os backups processados para `backups/sincronizados/`. Arquivos que não puderem ser lidos continuam na pasta de entrada e aparecem no aviso.

A pasta de entrada pode ser trocada em **Configurações**, por exemplo para uma pasta que você já usa. A escolha fica salva em `config/settings.json` e todos os aparelhos a carregam ao abrir o app. O diálogo “Abrir” do Google Drive também começa nela.

### Backup sem "Criar backup"

- **Computador com JW Library para Windows (versão desktop do app):** o app lê o banco do JW Library direto de
  `%LOCALAPPDATA%\Packages\WatchtowerBibleandTractSo.*\LocalState\UserData\userData.db` e, a cada **Sincronizar**, monta um
  `.jwlibrary` igual ao do app: `userData.db` com o `-wal` já aplicado, `default_thumbnail.png` e `manifest.json` com hash,
  versão do esquema e `LastModified`. O arquivo vai para a pasta de entrada e entra na mesclagem. Se nada mudou desde o último
  envio, não envia de novo. O banco só é alterado quando você toca em **Atualizar o JW Library** (veja as rodadas acima).
  Para outra instalação, defina `JW_LIBRARY_DB` com o caminho do `userData.db`.
- **Android:** o banco do JW Library fica na área privada do app, e nenhum outro app pode lê-lo sem root. O mais perto disso é
  um toque: JW Library › Criar backup › no menu Compartilhar, **Editor de Notas**. O arquivo vai para o Drive e entra na rodada.
- **iOS:** mesmo bloqueio do Android. Use o caminho normal pelo app do Drive.

> **Exclusões não se propagam:** como em qualquer mesclagem de backups do JW Library, uma nota apagada em um aparelho volta se ainda existir em outro backup ou no arquivo de `sync/`. Para apagar de vez, exclua-a no editor abrindo o arquivo de `sync/`; ao salvar, ele é atualizado no lugar.

## Como a mesclagem funciona

Os IDs são locais de cada aparelho, por isso os registros são casados por **chaves naturais**:

| Item | Chave | Conflito |
|---|---|---|
| Local (publicação/capítulo) | colunas identificadoras da `Location` | reaproveita o existente |
| Etiqueta | `(Type, Name)` | junta |
| Marcação | `UserMarkGuid`; mesmo trecho em outro GUID conta como duplicata | cor: política escolhida. Marcações parcialmente sobrepostas: fica uma só, e as notas são preservadas |
| Nota | `Guid`; mesmo texto no mesmo lugar conta como duplicata | versão mais recente pelo `LastModified` da nota |
| Marcador | `(publicação, posição)` | vai para uma posição livre. Se não houver, segue a política |
| Comentário (`InputField`) | `(local, campo)` | política escolhida |
| Listas de reprodução | rótulo + mídia | copia itens e arquivos de mídia que faltarem |

A política padrão é **"manter o mais recente"**. Também dá para preferir sempre o arquivo A ou o B. O resultado é um arquivo novo; os originais não são alterados.

## Configurar Google Drive / OneDrive

Sem configuração, o app funciona com arquivos do dispositivo. Para habilitar as nuvens, preencha `src/environments/environment.ts` (desenvolvimento) e `environment.prod.ts` (produção).

### Google Drive

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e ative a **Google Drive API**.
2. Em *Tela de consentimento OAuth*, escolha **Externo** e adicione sua conta como usuário de teste.
3. Em *Credenciais › Criar ID do cliente OAuth*, escolha o tipo **Aplicativo da Web** e adicione as origens JavaScript autorizadas:
   `http://localhost:4200` (dev), `http://localhost:47819` (desktop) e a URL de produção.
4. Copie o *Client ID* para `googleDrive.clientId`.

Escopo usado: `drive` (acesso completo). A sincronização precisa ler e **mover** os backups que o app do Drive no celular enviou, e escopos mais restritos (`drive.file`) não enxergam esses arquivos. É um escopo "restrito" do Google:

- em modo **Teste** (até 100 usuários de teste cadastrados), funciona sem verificação. Os usuários veem um aviso de "app não verificado" e podem continuar;
- para liberar a qualquer pessoa, o Google exige verificação do app e uma avaliação de segurança.

Esse Client ID é configurado **uma vez, por quem publica o app**. Os usuários só fazem login com a própria conta.

**Android:** o Google não permite o login web dentro do app, então no Android o token vem do Google Play Services. No mesmo
projeto do Google Cloud, crie também um *ID do cliente OAuth* do tipo **Android**, com o nome do pacote (`appId` de
`capacitor.config.ts`) e o SHA-1 da chave que assina o APK (`cd android && ./gradlew signingReport`). Não é preciso copiar
esse ID para o código.

### OneDrive

> Temporariamente oculto na interface. Para reativar, adicione `inject(OneDriveProvider)` à lista `STORAGE_PROVIDERS` em `src/app/app.config.ts`.

1. No [portal do Azure](https://portal.azure.com/), abra *App registrations › New registration*.
2. Em *Supported account types*, escolha **contas pessoais e organizacionais**.
3. Em *Authentication*, adicione a plataforma **Single-page application** com os redirect URIs
   `http://localhost:4200/auth-redirect.html`, `http://localhost:47819/auth-redirect.html` e o de produção.
4. Em *API permissions*, adicione as permissões delegadas `Files.ReadWrite` e `User.Read`.
5. Copie o *Application (client) ID* para `oneDrive.clientId`.

## Desktop (Windows, macOS, Linux) — Electron

```bash
npm run desktop:start   # build + abre a janela
npm run desktop:dist    # gera instalador em release/ (nsis, dmg ou AppImage conforme o SO)
```

O app é servido em `http://localhost:47819` dentro do Electron, então o roteamento e os redirects de OAuth funcionam igual à web.

**Dica:** com os apps oficiais do Google Drive ou do OneDrive instalados, as nuvens aparecem como pastas locais. A opção *Arquivos do dispositivo* abre e salva direto nelas, inclusive na mesma pasta do original, sem precisar de login no app.

## Android e iOS — Capacitor

```bash
npm run mobile:add:android   # uma vez (ou mobile:add:ios, em um Mac)
npm run mobile:android       # build + sync + abre no Android Studio
```

- A pasta `android/` é gerada e não é versionada. As peças nativas do app (receber o backup pelo menu Compartilhar e o login
  do Google pelo Play Services) ficam em `mobile/android/` e são aplicadas por `scripts/setup-android.cjs`, que roda sozinho em
  `mobile:add:android` e `mobile:sync`.
- **Abrir**: o seletor do sistema já mostra Drive, OneDrive e Arquivos.
- **Salvar**: o arquivo é gerado e o menu de compartilhar do sistema abre, para escolher Drive, OneDrive etc.

## Limitações conhecidas

- O Google bloqueia login OAuth em WebViews embutidas. No **Android** o app usa o Google Play Services (veja "Configurar Google Drive"). No **iOS** e às vezes no **Electron**, use os caminhos acima (seletor do sistema ou pastas sincronizadas) em vez do login do Google Drive no app. O OneDrive funciona via popup.
- O backup guarda a **posição** das marcações, não o texto marcado. Por isso a tela de marcações mostra parágrafo/versículo, não a frase.
- No JW Library, **restaurar um backup substitui** os dados do aparelho. Guarde sempre uma cópia do original.
