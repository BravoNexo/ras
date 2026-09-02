# Controle de RAS — BravoNexo

Frontend público e multiunidade para os militares consultarem o ciclo de RAS, escolherem oportunidades e ordenarem suas preferências.

## Endereços previstos

- Entrada do módulo: `https://bravonexo.github.io/ras/`
- 1º GBM e DBM 1/1: `https://bravonexo.github.io/ras/01gbm/`
- Backend atual do 1º GBM e DBM 1/1: `https://script.google.com/macros/s/AKfycbw3_b3VgwwiINW6hKDsqED4tMpWMSWvizocsWYyoAaKVCvRPx1ABRHhxUR-PFMltgcy_A/exec`

## Estrutura

```text
index.html          entrada do módulo e redirecionamento para o 1º GBM e DBM 1/1
shared/             JavaScript e estilos compartilhados
01gbm/              página, configuração e manifesto do 1º GBM e DBM 1/1
```

O repositório deve ser publicado pelo GitHub Pages a partir da raiz da branch `main`. Outras unidades podem receber uma pasta própria e um `config.js` apontando para seu respectivo Apps Script.

## Arquitetura

```text
GitHub Pages        → interface do militar
01gbm/config.js     → identificação da unidade e URL pública da API
Google Apps Script  → autenticação, regras, validações e gravações
Google Sheets       → dados administrativos do RAS
BravoNexo           → toda a administração do módulo
```

O frontend usa `fetch` com `Content-Type: text/plain;charset=utf-8`, o mesmo padrão já utilizado pelo módulo de Permutas. O corpo enviado possui o formato:

```json
{
  "api": "RAS_PORTAL_V1",
  "action": "requestAccessCode",
  "args": ["militar@exemplo.com"]
}
```

As únicas ações esperadas por esta interface são:

- `requestAccessCode`
- `verifyAccessCode`
- `getPortalData`
- `savePreferences`
- `logout`

O backend deve aceitar somente essa lista no roteador público. As operações administrativas e a ponte autenticada entre o BravoNexo e o RAS não devem ser expostas pelo frontend.

## Segurança

- O GitHub Pages e todos os arquivos deste diretório são públicos.
- Não adicionar senhas, códigos de acesso, segredos, tokens de sessão, chaves privadas, RGs, e-mails ou outros dados pessoais ao repositório.
- A URL de implantação do Apps Script é pública por definição e pode permanecer no `config.js`.
- Toda autorização continua sendo validada pelo Apps Script com código enviado por e-mail e sessão temporária.
- O segredo da ponte administrativa deve permanecer exclusivamente nas propriedades dos projetos Apps Script.
- O frontend não possui modo de demonstração nem simula gravações quando a API está indisponível.

## Publicação e validação

Antes de trocar o link oficial:

1. Publicar o roteador HTTP do Portal RAS no Apps Script.
2. Validar o envio e a conferência do código de acesso.
3. Validar restauração e encerramento da sessão.
4. Selecionar, remover, reordenar e salvar preferências.
5. Confirmar o bloqueio para militar temporariamente marcado como `Não concorre`.
6. Conferir a interface em celular e computador.
7. Manter o endereço antigo do Apps Script disponível durante a transição.

Ao trocar o domínio, as sessões já abertas não são transferidas. O militar precisará entrar uma vez no novo endereço; as preferências permanecem preservadas na planilha.
