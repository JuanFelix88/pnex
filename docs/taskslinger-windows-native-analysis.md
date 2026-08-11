# Análise técnica do TaskSlinger 0.8.21 para Windows

## Status

Análise estática do executável `taskslinger-v0.8.21-windows-x64.exe`, realizada sem executar o programa.

Este documento identifica a tecnologia e as características do build a partir dos cabeçalhos PE, importações, recursos, Rich Header, assinatura Authenticode e strings incorporadas ao binário. Como o código-fonte e os scripts de build não estão disponíveis publicamente, opções não registradas no executável são apresentadas como inferências, não como fatos confirmados.

## Resumo

O TaskSlinger 0.8.21 é uma aplicação desktop nativa para Windows, compilada em C e C++ com o toolchain Microsoft Visual C++. Sua interface usa diretamente a API Win32 e um renderer próprio baseado em Direct3D 11, DXGI, Direct2D e DirectWrite.

Não foram encontrados sinais de Electron, Tauri, .NET, Java, Qt, WebView ou outra camada de interface baseada em navegador.

| Área | Tecnologia identificada |
| --- | --- |
| Linguagens | C e C++ nativos |
| Plataforma | Win32, PE32+ x64 |
| Compilador | Microsoft Visual C++ 14.51 |
| Toolset provável | Visual Studio 2026 18.6, v145 |
| Linker | Microsoft Linker 14.51, build `36248` |
| Interface | Win32 customizada |
| Renderização | Direct3D 11 e DXGI |
| Texto e desenho 2D | DirectWrite e Direct2D |
| Monitoramento | Toolhelp, PSAPI, PDH, WMI, D3DKMT, DXCore e IP Helper |
| Rede | WinHTTP e Winsock |
| Segurança | WinTrust e CryptoAPI |
| Otimização | Whole Program Optimization e LTCG |
| Runtime | Provavelmente vinculado estaticamente |
| Distribuição | Executável único com instalação, atualização e desinstalação próprias |

## Identificação do arquivo

| Campo | Valor |
| --- | --- |
| Nome analisado | `taskslinger-v0.8.21-windows-x64.exe` |
| Tamanho | `2.195.128` bytes |
| SHA-256 | `49c118f00d31754fc3c856c89519b4a5cd14ad322d3c3e281a9edf5bc921aca1` |
| Formato | PE32+ |
| Arquitetura | AMD64/x86-64 |
| Subsistema | Windows GUI |
| Versão do produto | `v0.8.21` |
| Nome interno | `taskslinger` |
| Nome original | `taskslinger.exe` |

O executável possui sete seções PE:

```text
.text
.rdata
.data
.didat
.fptable
.rsrc
.reloc
```

Não existe cabeçalho CLR:

```text
CLRRuntimeHeaderRVA:  0
CLRRuntimeHeaderSize: 0
```

Isso descarta um aplicativo gerenciado por .NET.

## Linguagens e toolchain

### C e C++ nativos

O Rich Header contém entradas de objetos produzidos pelos compiladores C e C++ do MSVC. O binário também incorpora RTTI e tipos da biblioteca padrão de C++:

```text
.?AVbad_exception@std@@
.?AVexception@std@@
.?AVtype_info@@
```

Essas evidências confirmam que há código C++ no executável. As entradas do Rich Header também mostram objetos C. As contagens desse cabeçalho incluem bibliotecas e componentes do runtime, portanto não permitem calcular com precisão quanto do código da aplicação foi escrito em cada linguagem.

A conclusão segura é que se trata de um build nativo misto de C/C++, não de C puro.

### Microsoft Visual C++

O cabeçalho opcional do PE informa:

```text
MajorLinkerVersion: 14
MinorLinkerVersion: 51
```

O Rich Header registra builds `35721` e `36248` das ferramentas Microsoft. Esses valores são compatíveis com o MSVC 14.51, disponibilizado com o Visual Studio 2026 18.6 e o platform toolset v145.

Não há evidências de Clang, MinGW, GCC, Zig ou Rust como toolchain principal.

### Otimização em tempo de link

O diretório de depuração contém somente uma entrada do tipo:

```text
ILTCG
```

Isso comprova o uso de Link-Time Code Generation. Um build equivalente normalmente usa opções como:

```text
cl.exe /GL ...
link.exe /LTCG ...
```

Não há tabela COFF de símbolos nem referência CodeView a um arquivo PDB. O executável distribuído é, portanto, compatível com um build Release otimizado e sem símbolos públicos de depuração.

### Runtime C/C++

O executável não importa as DLLs usuais do runtime dinâmico:

```text
msvcp*.dll
vcruntime*.dll
ucrtbase.dll
```

Como código e tipos do runtime estão presentes internamente, há forte indicação de vinculação estática, provavelmente com `/MT`. Essa opção não pode ser confirmada de forma absoluta sem o projeto ou a linha de comando original do compilador.

## Interface e renderização

### Win32

A aplicação cria e controla suas próprias janelas por meio da API Win32. Entre as importações estão:

```text
CreateWindowExW
RegisterClassExW
DefWindowProcW
SetWindowLongPtrW
SetWindowPos
TrackPopupMenu
GetDpiForWindow
GetSystemMetricsForDpi
```

As DLLs correspondentes incluem `USER32.dll`, `GDI32.dll`, `SHELL32.dll` e `dwmapi.dll`.

Isso caracteriza uma aplicação Windows nativa, sem framework web intermediário.

### Direct3D 11 e DXGI

As importações gráficas incluem:

```text
D3D11CreateDevice
CreateDXGIFactory1
DwmSetWindowAttribute
DwmFlush
```

O renderer usa:

- Direct3D 11 para criação do dispositivo e renderização;
- DXGI para adaptadores, swap chains e apresentação;
- DWM para integração com o compositor do Windows;
- Direct2D para operações 2D;
- DirectWrite para texto.

Embora o programa mostre informações sobre feature levels até Direct3D 12.2, o caminho de renderização identificado no executável importa `D3D11CreateDevice`, não a API Direct3D 12.

### Shaders incorporados

Foram encontrados três blobs compilados no formato DXBC e referências aos seguintes nomes:

```text
taskslinger_vs_4_1.cso
taskslinger_ps_4_1.cso
taskslinger_graph_vs_4_1.cso
```

Os nomes indicam vertex e pixel shaders compatíveis com Shader Model 4.1. Os blobs estão incorporados aos recursos do executável, evitando arquivos de shader externos na distribuição.

## APIs de monitoramento do Windows

O TaskSlinger combina diversas APIs nativas para reproduzir e ampliar as funções do Gerenciador de Tarefas.

### Processos, threads e módulos

Foram identificadas APIs Toolhelp e PSAPI, incluindo:

```text
CreateToolhelp32Snapshot
Process32FirstW
Process32NextW
Thread32First
Thread32Next
Module32FirstW
Module32NextW
K32EnumProcessModulesEx
K32GetModuleInformation
ReadProcessMemory
VirtualQueryEx
```

### Desempenho

A aplicação usa `pdh.dll` para acessar contadores de desempenho:

```text
PdhOpenQueryW
PdhAddEnglishCounterW
PdhCollectQueryData
PdhGetFormattedCounterValue
PdhGetFormattedCounterArrayW
```

Também utiliza `QueryPerformanceCounter`, informações globais de memória e tempos de processo e thread.

### GPU

As tecnologias identificadas incluem:

- `D3DKMTQueryAdapterInfo` e outras APIs D3DKMT;
- carregamento dinâmico de `dxcore.dll`;
- referências a `WinHvPlatform.dll` para informações relacionadas à virtualização;
- consultas WMI de adaptadores e drivers de vídeo.

### WMI e COM

As importações de `ole32.dll` e `OLEAUT32.dll`, combinadas com consultas WQL incorporadas, confirmam o uso de WMI. Exemplos encontrados:

```sql
SELECT Capacity, Manufacturer, PartNumber, SerialNumber,
       ConfiguredClockSpeed, Speed, DeviceLocator, BankLabel,
       MemoryType, SMBIOSMemoryType, FormFactor
FROM Win32_PhysicalMemory
```

```sql
SELECT Name, AdapterCompatibility, PNPDeviceID, DriverVersion,
       DriverDate, AdapterRAM
FROM Win32_VideoController
```

O WMI é usado para informações de memória, vídeo, BIOS, sistema e segurança.

### Serviços e Registro

A aplicação usa o Service Control Manager e o Registro do Windows para listar e administrar serviços, programas de inicialização e configurações:

```text
OpenSCManagerW
EnumServicesStatusExW
QueryServiceConfigW
StartServiceW
ControlService
RegOpenKeyExW
RegEnumValueW
RegSetValueExW
RegDeleteValueW
```

### Rede

As conexões e os adaptadores são consultados por meio da IP Helper API:

```text
GetAdaptersAddresses
GetExtendedTcpTable
GetExtendedUdpTable
GetIfEntry2
SetTcpEntry
```

`WinHTTP.dll` é usado para requisições HTTP/HTTPS, incluindo verificação de atualizações. `WS2_32.dll` fornece operações auxiliares de endereços de rede.

### Assinaturas e confiança

A aplicação examina assinaturas digitais por meio de:

```text
WinVerifyTrust
CryptCATAdminCalcHashFromFileHandle2
CryptCATAdminEnumCatalogFromHash
CryptQueryObject
CertFindCertificateInStore
CertGetNameStringW
```

Isso permite mostrar o editor e o estado de confiança dos executáveis dos processos monitorados.

### Diagnóstico

`dbghelp.dll` é carregada com delay-load para acessar:

```text
MiniDumpWriteDump
```

A aplicação pode gerar minidumps em caso de falha sem manter `dbghelp.dll` carregada durante toda a execução.

## Instalação e empacotamento

O arquivo não foi reconhecido pelo 7-Zip como um arquivo autoextraível convencional. Ele é um PE nativo normal com lógica própria de instalação, atualização e desinstalação.

Strings e importações indicam:

```text
taskslinger.exe
taskslinger-maintenance.exe
taskslinger-uninstall.bat
taskslinger-uninstall-ifeo.ps1
Software\Microsoft\Windows\CurrentVersion\Uninstall\TaskSlinger
```

A presença de `Cabinet.dll` indica uso das APIs Cabinet para compactação ou extração durante instalação e atualização. O executável também contém verificações de segurança para impedir exclusão de diretórios inesperados durante a autodesinstalação.

## Assinatura digital

A assinatura Authenticode foi validada pelo Windows:

```text
Status: Signature verified
```

| Campo | Valor |
| --- | --- |
| Assinante | Thomas Klemenc |
| Emissor | Certum Code Signing 2021 CA |
| Thumbprint | `FF8EFA3BD946B7D73E2883A9EB8DD7453BABF7AC` |
| Validade | 27/05/2026 a 27/05/2027 |
| Timestamp | DigiCert SHA256 RSA4096 Timestamp Responder 2025 1 |

A assinatura confirma a integridade do arquivo desde a assinatura e identifica seu publicador. Ela não substitui uma auditoria de segurança do código.

## Proteções do executável

O cabeçalho PE habilita as seguintes proteções:

| Proteção | Estado |
| --- | --- |
| ASLR | Habilitado |
| High-entropy ASLR | Habilitado |
| DEP/NX | Habilitado |
| Control Flow Guard | Habilitado |
| Large Address Aware | Habilitado |
| Terminal Server Aware | Habilitado |

O Load Configuration Directory contém uma tabela válida de funções protegidas pelo Control Flow Guard.

## Metadados de build

Os recursos de versão incluem:

```text
FileVersion:    v0.8.21
ProductVersion: v0.8.21
BuildDate:      01.08.2026 15:23:18
CommitHash:     1aeb5ddba1e7446779889538403ad076a0831998
```

O timestamp do cabeçalho PE é `2026-08-01 15:24:39`. Timestamps PE podem ser alterados pelo processo de build, portanto devem ser tratados como metadados auxiliares.

## Tecnologias não encontradas

A análise não encontrou evidências das seguintes plataformas:

- Electron ou Node.js;
- Chromium Embedded Framework;
- WebView2;
- Tauri ou Rust;
- .NET/CLR;
- Java/JVM;
- Qt;
- GTK;
- React Native;
- interface HTML/CSS/JavaScript.

A ausência do CLR header, de DLLs desses frameworks e de um runtime de navegador, somada às importações diretas de Win32 e Direct3D, permite descartá-los com boa confiança.

## Pipeline de build provável

Sem acesso aos scripts originais, a reconstrução mais plausível é:

1. fontes C e C++ compilados pelo `cl.exe` do MSVC 14.51 para AMD64;
2. Whole Program Optimization habilitada nos objetos;
3. shaders compilados antecipadamente para DXBC/Shader Model 4.1;
4. shaders, ícones, traduções e metadados incluídos como recursos PE;
5. vinculação pelo linker Microsoft com LTCG e runtime C/C++ provavelmente estático;
6. geração de um único executável GUI;
7. aplicação de assinatura Authenticode com certificado Certum e timestamp DigiCert.

Uma linha de build conceitual seria semelhante a:

```text
cl.exe /O2 /GL /MT /EHsc /guard:cf /DUNICODE ...
link.exe /SUBSYSTEM:WINDOWS /LTCG /DYNAMICBASE /NXCOMPAT /GUARD:CF ...
```

Essa linha é ilustrativa. Somente `/LTCG`, o toolchain, o subsistema e as proteções podem ser confirmados diretamente pelos metadados analisados; `/O2`, `/MT` e `/EHsc` são inferências compatíveis com o resultado.

## Conclusão

O TaskSlinger demonstra uma arquitetura Windows deliberadamente nativa: C/C++, Win32 e renderização própria com Direct3D 11. Em vez de depender de um framework desktop completo, ele combina APIs específicas do sistema para janelas, gráficos, texto, processos, desempenho, rede, GPU, serviços, Registro e assinaturas digitais.

O resultado é um executável x64 pequeno, sem runtime web ou gerenciado, otimizado em tempo de link, com poucas dependências além das DLLs de sistema do Windows e protegido por mecanismos modernos do formato PE.
