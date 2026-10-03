// =====================================================================
// ESCALA DE PLANTÃO NOTURNO - v3.1
// Segunda a Quinta-feira | 1 Servidor + 1 Terceirizado por dia
// Sincronizado com LocalStorage e Firebase Firestore
// =====================================================================

// Dias oficiais de plantão (Segunda a Quinta)
const DIAS_PLANTAO = ["Segunda", "Terça", "Quarta", "Quinta"];

// Banco de dados em memória local
let db = {
    participantes: {},
    historico_escalas: []
};

// Instância e Configurações do Firebase Firestore Nuvem
let firestoreDb = null;
let sincronizandoComNuvem = false;
const FIREBASE_CONFIG_PADRAO = {
    apiKey: "AIzaSyAb41PleAsglzBLxQ6iFW3r2-cl15bYMCk",
    authDomain: "secexecpres-contatos.firebaseapp.com",
    projectId: "secexecpres-contatos",
    storageBucket: "secexecpres-contatos.firebasestorage.app",
    messagingSenderId: "841573722795",
    appId: "1:841573722795:web:3635d93cd513c6b1a6a5ee"
};
const FIRESTORE_COLLECTION = "escala_plantao_noturno";
const FIRESTORE_DOC = "dados_globais";

// Escala proposta temporária (ainda não gravada)
let escalaPropostaGlobal = null;
let semanaPropostaGlobal = "";

// Inicialização da aplicação
document.addEventListener("DOMContentLoaded", () => {
    // Garantir que nenhum modal comece aberto
    fecharModalEditarParticipante();
    fecharModalFirebaseConfig();

    loadData();
    inicializarDataSemana();
    renderAll();
    
    // Recuperar e exibir a última escala salva nos cards da tela
    recuperarUltimaEscalaNaTela();
    
    // Conectar à Nuvem (Firebase Firestore)
    initFirebase();
    
    // Form de cadastro de participantes
    const formCadastro = document.getElementById("form-cadastro");
    if (formCadastro) {
        formCadastro.addEventListener("submit", (e) => {
            e.preventDefault();
            const inputNome = document.getElementById("nome-participante");
            const selectTipo = document.getElementById("tipo-participante");
            const nome = inputNome ? inputNome.value.trim() : "";
            const tipo = selectTipo ? selectTipo.value : "servidor";

            if (nome) {
                const cadastrado = addParticipant(nome, tipo);
                if (cadastrado) {
                    inputNome.value = "";
                    renderAll();
                    const tipoLabel = tipo === "servidor" ? "Servidor" : "Terceirizado";
                    showToast(`Participante "${nome}" (${tipoLabel}) adicionado com sucesso!`, "success");
                }
            }
        });
    }

    // Botão de gerar escala
    const btnGerar = document.getElementById("gerar-escala-btn");
    if (btnGerar) {
        btnGerar.addEventListener("click", () => {
            gerarEscalaSemanal();
        });
    }

    // Botão de confirmar escala
    const btnConfirmar = document.getElementById("confirmar-escala-btn");
    if (btnConfirmar) {
        btnConfirmar.addEventListener("click", () => {
            confirmarESalvarEscala();
        });
    }

    // Botão de exportar para Excel
    const btnExportar = document.getElementById("exportar-excel-btn");
    if (btnExportar) {
        btnExportar.addEventListener("click", () => {
            exportarEscalaExcel();
        });
    }
});

// --- PERSISTÊNCIA (LOCALSTORAGE) ---

function loadData() {
    const rawData = localStorage.getItem("plantao_noturno_db");
    if (rawData) {
        try {
            db = JSON.parse(rawData);
            if (!db.participantes) db.participantes = {};
            if (!db.historico_escalas) db.historico_escalas = [];

            // Migração de schema: garantir tipo e disponibilidade restrita a Segunda-Quinta
            Object.keys(db.participantes).forEach(nome => {
                const p = db.participantes[nome];
                if (!p.tipo) {
                    p.tipo = "servidor";
                }
                if (!p.disponibilidade || !Array.isArray(p.disponibilidade)) {
                    p.disponibilidade = [...DIAS_PLANTAO];
                } else {
                    p.disponibilidade = p.disponibilidade.filter(d => DIAS_PLANTAO.includes(d));
                    if (p.disponibilidade.length === 0) {
                        p.disponibilidade = [...DIAS_PLANTAO];
                    }
                }
            });
        } catch (e) {
            console.error("Erro ao carregar dados do LocalStorage, resetando banco local.", e);
            db = { participantes: {}, historico_escalas: [] };
        }
    } else {
        // Dados iniciais
        db = {
            participantes: {
                "Patricia": { plantoes: 1, ativo: true, tipo: "servidor", disponibilidade: [...DIAS_PLANTAO] },
                "Valeria": { plantoes: 1, ativo: true, tipo: "servidor", disponibilidade: [...DIAS_PLANTAO] },
                "Debora": { plantoes: 1, ativo: true, tipo: "servidor", disponibilidade: [...DIAS_PLANTAO] },
                "Gustavo": { plantoes: 1, ativo: true, tipo: "terceirizado", disponibilidade: [...DIAS_PLANTAO] },
                "Laryssa": { plantoes: 1, ativo: true, tipo: "terceirizado", disponibilidade: [...DIAS_PLANTAO] }
            },
            historico_escalas: [
                {
                    semana: "2026-W36",
                    semanaTexto: "Semana 36 de 2026 (do dia 31/08/2026 ao dia 03/09/2026)",
                    escala: {
                        "Segunda": { servidor: "Patricia", terceirizado: "Gustavo" },
                        "Terça": { servidor: "Valeria", terceirizado: "Laryssa" },
                        "Quarta": { servidor: "Debora", terceirizado: "Gustavo" },
                        "Quinta": { servidor: "Patricia", terceirizado: "Laryssa" }
                    }
                }
            ]
        };
        saveData();
    }
}

function saveData() {
    localStorage.setItem("plantao_noturno_db", JSON.stringify(db));

    if (!sincronizandoComNuvem) {
        salvarNaNuvem(db);
    }
}

// --- SINCRONIZAÇÃO EM NUVEM (FIREBASE FIRESTORE) ---

function initFirebase() {
    if (typeof firebase === "undefined") {
        console.warn("Firebase SDK não carregado. Operando em modo LocalStorage.");
        atualizarStatusNuvem(false, "Firebase indisponível (Modo Local)");
        return;
    }

    try {
        let config = FIREBASE_CONFIG_PADRAO;
        const configSalva = localStorage.getItem("firebase_custom_config");
        if (configSalva) {
            try {
                config = JSON.parse(configSalva);
            } catch (err) {
                console.error("Erro ao ler firebase_custom_config, usando padrão:", err);
            }
        }

        if (!firebase.apps || firebase.apps.length === 0) {
            firebase.initializeApp(config);
        }
        firestoreDb = firebase.firestore();

        atualizarStatusNuvem(true, "Conectando ao banco de dados em tempo real...");

        firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC)
            .onSnapshot((doc) => {
                if (doc.exists) {
                    const dadosNuvem = doc.data();
                    aplicarDadosNuvem(dadosNuvem);
                } else {
                    salvarNaNuvem(db);
                    atualizarStatusNuvem(true, "Base de dados na nuvem inicializada com sucesso!");
                }
            }, (erro) => {
                console.warn("Erro no listener em tempo real do Firestore:", erro);
                atualizarStatusNuvem(false, "Sem conexão com a nuvem (Modo Local)");
            });
    } catch (e) {
        console.error("Falha ao inicializar Firebase:", e);
        atualizarStatusNuvem(false, "Erro ao conectar (Modo Local)");
    }
}

function aplicarDadosNuvem(dadosNuvem) {
    if (!dadosNuvem || typeof dadosNuvem !== "object") return;

    const dadosFormatados = {
        participantes: dadosNuvem.participantes || {},
        historico_escalas: dadosNuvem.historico_escalas || []
    };

    Object.keys(dadosFormatados.participantes).forEach(nome => {
        const p = dadosFormatados.participantes[nome];
        if (!p.tipo) p.tipo = "servidor";
        if (!p.disponibilidade) p.disponibilidade = [...DIAS_PLANTAO];
    });

    const jsonAtual = JSON.stringify(db);
    const jsonNovo = JSON.stringify(dadosFormatados);

    if (jsonAtual !== jsonNovo) {
        sincronizandoComNuvem = true;
        db = dadosFormatados;
        localStorage.setItem("plantao_noturno_db", jsonNovo);
        renderAll();
        recuperarUltimaEscalaNaTela();
        sincronizandoComNuvem = false;

        const horaStr = new Date().toLocaleTimeString('pt-BR');
        atualizarStatusNuvem(true, `Sincronizado em tempo real às ${horaStr}`);
    } else {
        const horaStr = new Date().toLocaleTimeString('pt-BR');
        atualizarStatusNuvem(true, `Sincronizado às ${horaStr}`);
    }
}

function salvarNaNuvem(dados) {
    if (!firestoreDb) return;

    firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC)
        .set({
            participantes: dados.participantes || {},
            historico_escalas: dados.historico_escalas || [],
            atualizadoEm: firebase.firestore.FieldValue.serverTimestamp()
        })
        .then(() => {
            const horaStr = new Date().toLocaleTimeString('pt-BR');
            atualizarStatusNuvem(true, `Salvo na nuvem às ${horaStr}`);
        })
        .catch((err) => {
            console.warn("Aviso ao salvar na nuvem:", err);
            atualizarStatusNuvem(false, "Falha ao gravar na nuvem (Salvo localmente)");
        });
}

function atualizarStatusNuvem(conectado, texto) {
    const statusNuvem = document.getElementById("status-nuvem");
    const pontoStatus = document.getElementById("ponto-status-nuvem");
    const textoStatus = document.getElementById("texto-status-nuvem");
    const badgePainel = document.getElementById("badge-painel-nuvem");
    const detalheUltima = document.getElementById("detalhe-ultima-sincronizacao");

    if (conectado) {
        if (statusNuvem) {
            statusNuvem.className = "text-xs font-bold px-3 py-1.5 rounded-full border shadow-sm flex items-center space-x-1.5 bg-emerald-50 text-emerald-700 border-emerald-200 transition-all";
        }
        if (pontoStatus) {
            pontoStatus.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
        }
        if (textoStatus) {
            textoStatus.textContent = "Nuvem Sincronizada";
        }
        if (badgePainel) {
            badgePainel.className = "text-xs bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-0.5 rounded-full font-bold";
            badgePainel.textContent = "Ativa (Tempo Real)";
        }
        if (detalheUltima && texto) {
            detalheUltima.innerHTML = `<i class="fa-solid fa-cloud-check text-emerald-600 mr-1.5"></i> ${texto}`;
        }
    } else {
        if (statusNuvem) {
            statusNuvem.className = "text-xs font-bold px-3 py-1.5 rounded-full border shadow-sm flex items-center space-x-1.5 bg-amber-50 text-amber-700 border-amber-200 transition-all";
        }
        if (pontoStatus) {
            pontoStatus.className = "w-2 h-2 rounded-full bg-amber-500";
        }
        if (textoStatus) {
            textoStatus.textContent = "Modo Local (Offline)";
        }
        if (badgePainel) {
            badgePainel.className = "text-xs bg-amber-100 text-amber-800 border border-amber-300 px-2.5 py-0.5 rounded-full font-bold";
            badgePainel.textContent = "Modo Local";
        }
        if (detalheUltima && texto) {
            detalheUltima.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-amber-600 mr-1.5"></i> ${texto}`;
        }
    }
}

function forcarSincronizacaoNuvem() {
    if (!firestoreDb) {
        showToast("Conectando ao Firebase...", "info");
        initFirebase();
        return;
    }
    showToast("Sincronizando com a nuvem...", "info");
    salvarNaNuvem(db);
}

function abrirModalFirebaseConfig() {
    const modal = document.getElementById("modal-firebase-config");
    const textarea = document.getElementById("input-firebase-config");
    if (modal && textarea) {
        const configSalva = localStorage.getItem("firebase_custom_config");
        textarea.value = configSalva || JSON.stringify(FIREBASE_CONFIG_PADRAO, null, 2);
        modal.classList.remove("hidden");
    }
}

function fecharModalFirebaseConfig() {
    const modal = document.getElementById("modal-firebase-config");
    if (modal) modal.classList.add("hidden");
}

function salvarFirebaseConfigPersonalizada() {
    const textarea = document.getElementById("input-firebase-config");
    if (!textarea) return;
    try {
        const parsed = JSON.parse(textarea.value.trim());
        if (!parsed.projectId || !parsed.apiKey) {
            showToast("A configuração deve conter pelo menos 'projectId' e 'apiKey'.", "error");
            return;
        }
        localStorage.setItem("firebase_custom_config", JSON.stringify(parsed));
        fecharModalFirebaseConfig();
        showToast("Configuração salva! Recarregando conexão...", "success");
        setTimeout(() => location.reload(), 800);
    } catch (e) {
        showToast("JSON de configuração inválido. Verifique as chaves e vírgulas.", "error");
    }
}

function restaurarPadraoFirebaseConfig() {
    localStorage.removeItem("firebase_custom_config");
    fecharModalFirebaseConfig();
    showToast("Configuração padrão restaurada! Recarregando...", "success");
    setTimeout(() => location.reload(), 800);
}

// --- CONTROLE DE PARTICIPANTES ---

function addParticipant(nome, tipo = "servidor") {
    if (db.participantes[nome]) {
        showToast(`Participante "${nome}" já está cadastrado.`, "error");
        return false;
    }
    db.participantes[nome] = {
        plantoes: 0,
        ativo: true,
        tipo: tipo, // "servidor" ou "terceirizado"
        disponibilidade: [...DIAS_PLANTAO]
    };
    saveData();
    return true;
}

function toggleParticipantTipo(nome) {
    if (db.participantes[nome]) {
        const novoTipo = db.participantes[nome].tipo === "servidor" ? "terceirizado" : "servidor";
        db.participantes[nome].tipo = novoTipo;
        saveData();
        renderAll();
        const label = novoTipo === "servidor" ? "Servidor" : "Terceirizado";
        showToast(`"${nome}" alterado para categoria ${label}.`, "success");
    }
}

function removeParticipant(nome) {
    if (db.participantes[nome]) {
        delete db.participantes[nome];
        saveData();
        renderAll();
        showToast(`Participante "${nome}" foi excluído.`, "success");
    }
}

function toggleParticipantStatus(nome, active) {
    if (db.participantes[nome]) {
        db.participantes[nome].ativo = active;
        saveData();
        renderAll();
        showToast(`Status de "${nome}" alterado para ${active ? "Ativo" : "Inativo"}.`, "success");
    }
}

function resetAllPlantoes() {
    for (const nome of Object.keys(db.participantes)) {
        db.participantes[nome].plantoes = 0;
    }
    db.historico_escalas = [];
    saveData();
    renderAll();
    showToast("Contadores de plantões e históricos resetados para zero!", "success");
}

function confirmResetAllPlantoes() {
    if (confirm("ATENÇÃO: Você deseja realmente zerar o contador de plantões de TODOS os participantes e apagar o histórico de escalas anteriores? Esta ação não pode ser desfeita.")) {
        resetAllPlantoes();
    }
}

// --- ALGORITMO DE AGENDAMENTO (BACKTRACKING + JUSTIÇA POR CATEGORIA) ---

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Resolve o agendamento de uma categoria específica (servidor ou terceirizado)
 * para os dias Segunda a Quinta, priorizando justiça (menor saldo de plantão acumulado).
 */
function solveRoleSchedule(tipoDesejado, disponibilidades, feriados = []) {
    const dias = DIAS_PLANTAO;
    const ativosRole = {};

    for (const [nome, dados] of Object.entries(db.participantes)) {
        if (dados.ativo && dados.tipo === tipoDesejado) {
            ativosRole[nome] = dados;
        }
    }

    const nomesRole = Object.keys(ativosRole);
    if (nomesRole.length === 0) {
        const label = tipoDesejado === "servidor" ? "Servidor" : "Terceirizado";
        const escalaVazia = {};
        dias.forEach(d => escalaVazia[d] = feriados.includes(d) ? "FERIADO" : null);
        return {
            escala: escalaVazia,
            alertas: [`Nenhum <strong>${label}</strong> ativo cadastrado no sistema.`]
        };
    }

    // Mapear candidatos por dia
    const candidatosPorDia = {};
    dias.forEach(d => { candidatosPorDia[d] = []; });

    for (const [nome, diasDisponiveis] of Object.entries(disponibilidades)) {
        if (ativosRole[nome]) {
            for (const dia of diasDisponiveis) {
                if (candidatosPorDia[dia]) {
                    candidatosPorDia[dia].push(nome);
                }
            }
        }
    }

    // Ordenar candidatos por saldo de plantão com desempate aleatório
    for (const dia of dias) {
        let candidatos = candidatosPorDia[dia];
        candidatos = shuffleArray(candidatos);
        candidatos.sort((a, b) => ativosRole[a].plantoes - ativosRole[b].plantoes);
        candidatosPorDia[dia] = candidatos;
    }

    let bestSchedule = {};
    dias.forEach(d => bestSchedule[d] = feriados.includes(d) ? "FERIADO" : null);
    let bestScore = -1;

    function backtrack(diaIdx, currentSchedule, currentUsedPeople) {
        if (diaIdx === dias.length) {
            let score = 0;
            for (const dia of dias) {
                const p = currentSchedule[dia];
                if (p === "FERIADO") {
                    score += 100000;
                } else if (p) {
                    score += 100000 - ativosRole[p].plantoes;
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestSchedule = { ...currentSchedule };
            }
            return;
        }

        const dia = dias[diaIdx];

        if (feriados.includes(dia)) {
            currentSchedule[dia] = "FERIADO";
            backtrack(diaIdx + 1, currentSchedule, currentUsedPeople);
            currentSchedule[dia] = null;
            return;
        }

        const candidatos = candidatosPorDia[dia] || [];
        let alocouAlguem = false;

        // 1ª Tentativa: alocar alguém que ainda não foi usado nesta semana
        for (const p of candidatos) {
            if (!currentUsedPeople.has(p)) {
                currentSchedule[dia] = p;
                currentUsedPeople.add(p);

                backtrack(diaIdx + 1, currentSchedule, currentUsedPeople);

                currentUsedPeople.delete(p);
                currentSchedule[dia] = null;
                alocouAlguem = true;
            }
        }

        // 2ª Tentativa (fallback): se a equipe tiver menos pessoas que dias de plantão, permitir repetição
        if (!alocouAlguem && nomesRole.length < dias.length && candidatos.length > 0) {
            for (const p of candidatos) {
                currentSchedule[dia] = p;
                backtrack(diaIdx + 1, currentSchedule, currentUsedPeople);
                currentSchedule[dia] = null;
                alocouAlguem = true;
            }
        }

        // Se ninguém pôde ser alocado, deixa o dia vago
        if (!alocouAlguem || candidatos.length === 0) {
            currentSchedule[dia] = null;
            backtrack(diaIdx + 1, currentSchedule, currentUsedPeople);
            currentSchedule[dia] = null;
        }
    }

    const initSchedule = {};
    dias.forEach(d => initSchedule[d] = null);
    backtrack(0, initSchedule, new Set());

    const label = tipoDesejado === "servidor" ? "Servidor" : "Terceirizado";
    const alertas = [];
    for (const dia of dias) {
        if (!bestSchedule[dia] && !feriados.includes(dia)) {
            alertas.push(`Aviso: Não foi possível alocar nenhum <strong>${label}</strong> para a <strong>${dia}</strong>.`);
        }
    }

    return { escala: bestSchedule, alertas };
}

/**
 * Resolve a escala completa gerando 2 participantes por dia (1 Servidor + 1 Terceirizado)
 */
function solveSchedule(disponibilidades, feriados = []) {
    const resServidor = solveRoleSchedule("servidor", disponibilidades, feriados);
    const resTerceirizado = solveRoleSchedule("terceirizado", disponibilidades, feriados);

    const dias = DIAS_PLANTAO;
    const escalaFinal = {};

    dias.forEach(dia => {
        escalaFinal[dia] = {
            servidor: resServidor.escala[dia] || null,
            terceirizado: resTerceirizado.escala[dia] || null
        };
    });

    const alertas = [...resServidor.alertas, ...resTerceirizado.alertas];
    return { escala: escalaFinal, alertas };
}

// Execução da geração de escala na Interface
function gerarEscalaSemanal() {
    const ativos = Object.keys(db.participantes).filter(nome => db.participantes[nome].ativo);
    if (ativos.length === 0) {
        showToast("Cadastre e ative pelo menos 1 participante antes de gerar a escala.", "error");
        return;
    }

    const inputSemana = document.getElementById("semana-selecionada");
    semanaPropostaGlobal = inputSemana ? inputSemana.value : "";
    if (!semanaPropostaGlobal) {
        showToast("Por favor, selecione a semana do plantão.", "error");
        return;
    }

    // Coletar disponibilidades da tabela
    const disponibilidades = {};
    const dias = DIAS_PLANTAO;
    
    ativos.forEach(nome => {
        disponibilidades[nome] = [];
        dias.forEach(dia => {
            const check = document.getElementById(`disp-${nome}-${dia}`);
            if (check && check.checked) {
                disponibilidades[nome].push(dia);
            }
        });
    });

    // Coletar feriados marcados
    const feriados = [];
    dias.forEach(dia => {
        const checkFeriado = document.getElementById(`feriado-${dia}`);
        if (checkFeriado && checkFeriado.checked) {
            feriados.push(dia);
        }
    });

    // Se já existe uma escala cadastrada para essa semana no histórico, avisar antes de sobrescrever
    const existeIndex = db.historico_escalas.findIndex(h => h.semana === semanaPropostaGlobal);
    if (existeIndex !== -1) {
        const hExistente = db.historico_escalas[existeIndex];
        if (!confirm(`Já existe uma escala salva no histórico para a ${hExistente.semanaTexto || semanaPropostaGlobal}. Deseja regerar e atualizar os dados no histórico?`)) {
            return;
        }
    }

    // Rodar algoritmo para Servidores e Terceirizados
    const resultado = solveSchedule(disponibilidades, feriados);
    escalaPropostaGlobal = JSON.parse(JSON.stringify(resultado.escala));

    // Salvar automaticamente no histórico
    salvarEscalaNoHistorico(semanaPropostaGlobal, escalaPropostaGlobal);

    // Exibir Alertas se houver
    const containerAlertas = document.getElementById("container-alertas-escala");
    const listaAlertas = document.getElementById("lista-alertas-escala");
    
    if (containerAlertas && listaAlertas) {
        if (resultado.alertas.length > 0) {
            containerAlertas.classList.remove("hidden");
            listaAlertas.innerHTML = resultado.alertas.map(a => `<li>${a}</li>`).join("");
        } else {
            containerAlertas.classList.add("hidden");
            listaAlertas.innerHTML = "";
        }
    }

    // Exibir Escala Resultante
    exibirCardsEscala(semanaPropostaGlobal, escalaPropostaGlobal);
    const secaoResultado = document.getElementById("secao-resultado-escala");
    if (secaoResultado) secaoResultado.scrollIntoView({ behavior: 'smooth' });
    showToast("Escala (1 Servidor + 1 Terceirizado) gerada e salva no Histórico!", "success");
}

function exibirCardsEscala(semana, escala) {
    const secaoResultado = document.getElementById("secao-resultado-escala");
    const cardsContainer = document.getElementById("escala-cards-container");
    if (!secaoResultado || !cardsContainer) return;
    cardsContainer.innerHTML = "";

    const dias = DIAS_PLANTAO;
    const diasComDatas = getDaysOfWeekWithDates(semana) || {};

    // Coletar TODOS os participantes ativos (Servidores + Terceirizados juntos)
    const todosAtivos = Object.keys(db.participantes)
        .filter(n => db.participantes[n].ativo)
        .sort((a, b) => a.localeCompare(b));

    dias.forEach(dia => {
        const diaData = escala[dia] || {};
        const p1Atual = typeof diaData === "object" ? (diaData.servidor || diaData.p1) : diaData;
        const p2Atual = typeof diaData === "object" ? (diaData.terceirizado || diaData.p2) : null;

        const ehFeriado = (p1Atual === "FERIADO" && p2Atual === "FERIADO");
        const card = document.createElement("div");

        if (ehFeriado) {
            card.className = "p-4 rounded-xl border shadow-sm flex flex-col justify-between text-center transition-all bg-amber-50 border-amber-300 text-amber-900";
        } else {
            card.className = "p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between transition-all bg-white hover:border-blue-300";
        }

        // Gerar as opções com TODOS os participantes cadastrados
        const gerarOpcoesPlantonista = (nomeAtual) => {
            let opts = `<option value="">-- VAGO --</option>`;
            opts += `<option value="FERIADO" ${nomeAtual === "FERIADO" ? "selected" : ""}>🏖️ FERIADO</option>`;
            todosAtivos.forEach(nome => {
                const selected = (nome === nomeAtual) ? "selected" : "";
                const p = db.participantes[nome];
                const pl = p ? p.plantoes : 0;
                const badgeTipo = p && p.tipo === "servidor" ? "🏛️ Servidor" : "🛠️ Terceirizado";
                opts += `<option value="${nome}" ${selected}>${nome} (${badgeTipo} - ${pl} pl.)</option>`;
            });
            return opts;
        };

        card.innerHTML = `
            <div>
                <div class="border-b border-gray-100 pb-2 mb-3 flex items-center justify-between">
                    <span class="text-xs font-extrabold text-blue-700 uppercase tracking-wider">${diasComDatas[dia] || dia}</span>
                    <span class="text-xs px-2 py-0.5 rounded-full font-bold ${ehFeriado ? 'bg-amber-200 text-amber-900' : 'bg-blue-50 text-blue-800'}">
                        ${ehFeriado ? 'Feriado' : '2 Plantonistas'}
                    </span>
                </div>

                <div class="space-y-3 text-left">
                    <!-- Slot 1: Plantonista 1 -->
                    <div class="bg-blue-50/70 p-2.5 rounded-lg border border-blue-200">
                        <label class="block text-xs font-bold text-blue-900 mb-1 flex items-center justify-between">
                            <span><i class="fa-solid fa-user-check mr-1 text-blue-600"></i> Plantonista 1:</span>
                            <span class="text-[10px] font-semibold text-blue-600">${p1Atual && p1Atual !== 'FERIADO' ? 'Plantão' : ''}</span>
                        </label>
                        <select onchange="atualizarEscalaManual('${dia}', 'servidor', this.value)" class="w-full text-xs font-semibold text-gray-900 border border-gray-300 rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm">
                            ${gerarOpcoesPlantonista(p1Atual)}
                        </select>
                    </div>

                    <!-- Slot 2: Plantonista 2 -->
                    <div class="bg-indigo-50/70 p-2.5 rounded-lg border border-indigo-200">
                        <label class="block text-xs font-bold text-indigo-900 mb-1 flex items-center justify-between">
                            <span><i class="fa-solid fa-user-check mr-1 text-indigo-600"></i> Plantonista 2:</span>
                            <span class="text-[10px] font-semibold text-indigo-600">${p2Atual && p2Atual !== 'FERIADO' ? 'Plantão' : ''}</span>
                        </label>
                        <select onchange="atualizarEscalaManual('${dia}', 'terceirizado', this.value)" class="w-full text-xs font-semibold text-gray-900 border border-gray-300 rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white shadow-sm">
                            ${gerarOpcoesPlantonista(p2Atual)}
                        </select>
                    </div>
                </div>
            </div>
        `;
        cardsContainer.appendChild(card);
    });

    secaoResultado.classList.remove("hidden");
}

function recuperarUltimaEscalaNaTela() {
    if (db.historico_escalas && db.historico_escalas.length > 0) {
        const inputSemana = document.getElementById("semana-selecionada");
        const ultima = db.historico_escalas[0];
        if (inputSemana) {
            inputSemana.value = ultima.semana;
            atualizarTextoSemana();
        }
        escalaPropostaGlobal = JSON.parse(JSON.stringify(ultima.escala));
        semanaPropostaGlobal = ultima.semana;
        exibirCardsEscala(semanaPropostaGlobal, escalaPropostaGlobal);
    }
}

function salvarEscalaNoHistorico(semana, escala) {
    if (!semana || !escala) return false;

    const parts = semana.split("-W");
    const datas = getDatesOfWeek(semana);
    const intervaloTexto = datas ? ` (${datas.formatted})` : "";
    const semanaTexto = parts.length === 2 ? `Semana ${parts[1]} de ${parts[0]}${intervaloTexto}` : semana;

    // Se já existe escala cadastrada para essa semana no histórico: abater saldos prévios
    const existeIndex = db.historico_escalas.findIndex(h => h.semana === semana);
    if (existeIndex !== -1) {
        const escalaAntiga = db.historico_escalas[existeIndex].escala;
        Object.values(escalaAntiga).forEach(item => {
            if (typeof item === "object" && item !== null) {
                if (item.servidor && item.servidor !== "FERIADO" && db.participantes[item.servidor]) {
                    db.participantes[item.servidor].plantoes = Math.max(0, db.participantes[item.servidor].plantoes - 1);
                }
                if (item.terceirizado && item.terceirizado !== "FERIADO" && db.participantes[item.terceirizado]) {
                    db.participantes[item.terceirizado].plantoes = Math.max(0, db.participantes[item.terceirizado].plantoes - 1);
                }
            } else if (typeof item === "string" && item !== "FERIADO" && db.participantes[item]) {
                db.participantes[item].plantoes = Math.max(0, db.participantes[item].plantoes - 1);
            }
        });
        db.historico_escalas.splice(existeIndex, 1);
    }

    // Adicionar +1 no saldo das pessoas escaladas
    Object.values(escala).forEach(item => {
        if (typeof item === "object" && item !== null) {
            if (item.servidor && item.servidor !== "FERIADO" && db.participantes[item.servidor]) {
                db.participantes[item.servidor].plantoes += 1;
            }
            if (item.terceirizado && item.terceirizado !== "FERIADO" && db.participantes[item.terceirizado]) {
                db.participantes[item.terceirizado].plantoes += 1;
            }
        }
    });

    // Salvar no histórico
    db.historico_escalas.push({
        semana: semana,
        semanaTexto: semanaTexto,
        escala: JSON.parse(JSON.stringify(escala))
    });

    // Ordenar histórico por semana decrescente
    db.historico_escalas.sort((a, b) => b.semana.localeCompare(a.semana));

    saveData();
    renderHistorico();
    renderParticipantes();
    renderDisponibilidades();
    return true;
}

function confirmarESalvarEscala() {
    if (!escalaPropostaGlobal || !semanaPropostaGlobal) {
        showToast("Nenhuma escala pendente na tela.", "error");
        return;
    }

    salvarEscalaNoHistorico(semanaPropostaGlobal, escalaPropostaGlobal);
    showToast("Escala confirmada e salva no Histórico!", "success");
}

function atualizarEscalaManual(dia, tipo, novoNome) {
    if (!escalaPropostaGlobal || !semanaPropostaGlobal) return;

    if (!escalaPropostaGlobal[dia]) {
        escalaPropostaGlobal[dia] = { servidor: null, terceirizado: null };
    }

    const antigoNome = escalaPropostaGlobal[dia][tipo];
    if (antigoNome === novoNome) return;

    // Atualizar no objeto em memória
    escalaPropostaGlobal[dia][tipo] = novoNome || null;

    // Sincronizar saldos de plantões
    if (antigoNome && antigoNome !== "FERIADO" && db.participantes[antigoNome]) {
        db.participantes[antigoNome].plantoes = Math.max(0, db.participantes[antigoNome].plantoes - 1);
    }
    if (novoNome && novoNome !== "FERIADO" && db.participantes[novoNome]) {
        db.participantes[novoNome].plantoes += 1;
    }

    // Sincronizar no histórico gravado
    const histItem = db.historico_escalas.find(h => h.semana === semanaPropostaGlobal);
    if (histItem) {
        if (!histItem.escala[dia] || typeof histItem.escala[dia] !== "object") {
            histItem.escala[dia] = {};
        }
        histItem.escala[dia][tipo] = novoNome || null;
    } else {
        salvarEscalaNoHistorico(semanaPropostaGlobal, escalaPropostaGlobal);
    }

    saveData();
    renderHistorico();
    renderParticipantes();
    renderDisponibilidades();

    const labelTipo = tipo === "servidor" ? "Servidor" : "Terceirizado";
    const labelFeedback = (novoNome === "FERIADO") ? "FERIADO" : (novoNome || "VAGO");
    showToast(`${labelTipo} de ${dia} alterado para: ${labelFeedback}!`, "success");
}

// --- EXPORTAÇÃO PARA EXCEL (SHEETJS) ---

function exportarEscalaExcel() {
    if (!escalaPropostaGlobal) return;
    
    const parts = semanaPropostaGlobal.split("-W");
    const datas = getDatesOfWeek(semanaPropostaGlobal);
    const intervaloTexto = datas ? ` (${datas.formatted})` : "";
    const semanaTexto = parts.length === 2 ? `Semana ${parts[1]} de ${parts[0]}${intervaloTexto}` : semanaPropostaGlobal;

    const dias = DIAS_PLANTAO;
    const diasComDatas = getDaysOfWeekWithDates(semanaPropostaGlobal) || {};

    function formatarPessoaExcel(val) {
        if (val === "FERIADO") return "FERIADO";
        return val || "VAGO";
    }

    // Montar linhas da planilha
    const dadosExcel = [
        ["ESCALA DE PLANTÃO NOTURNO"],
        [semanaTexto.toUpperCase()],
        ["Regra: Segunda a Quinta-feira | 1 Servidor e 1 Terceirizado por dia"],
        [],
        ["Dia da Semana", "Data de Referência", "Servidor", "Terceirizado"]
    ];

    dias.forEach(dia => {
        const diaData = escalaPropostaGlobal[dia] || {};
        const serv = typeof diaData === "object" ? diaData.servidor : diaData;
        const terc = typeof diaData === "object" ? diaData.terceirizado : "";
        const labelData = diasComDatas[dia] || dia;

        dadosExcel.push([
            dia,
            labelData,
            formatarPessoaExcel(serv),
            formatarPessoaExcel(terc)
        ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(dadosExcel);

    ws["!cols"] = [
        { wch: 18 },
        { wch: 26 },
        { wch: 28 },
        { wch: 28 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Escala");
    
    const nomeArquivo = `escala_plantao_${semanaPropostaGlobal}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);
    showToast(`Planilha Excel exportada: ${nomeArquivo}`, "success");
}

// --- RENDERIZAÇÃO DA INTERFACE (DOM) ---

function renderAll() {
    renderParticipantes();
    renderDisponibilidades();
    renderHistorico();
}

function renderParticipantes() {
    const listBody = document.getElementById("corpo-lista-participantes");
    const avisoVazio = document.getElementById("aviso-lista-vazia");
    if (!listBody || !avisoVazio) return;

    listBody.innerHTML = "";
    const nomes = Object.keys(db.participantes).sort();

    if (nomes.length === 0) {
        avisoVazio.classList.remove("hidden");
        return;
    } else {
        avisoVazio.classList.add("hidden");
    }

    nomes.forEach(nome => {
        const p = db.participantes[nome];
        const ehServidor = (p.tipo === "servidor");
        const nomeEscapado = nome.replace(/'/g, "\\'");
        const tr = document.createElement("tr");
        tr.className = "hover:bg-gray-50 transition-colors";
        
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">${nome}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
                <button onclick="toggleParticipantTipo('${nomeEscapado}')" title="Clique para alternar categoria" class="px-3 py-1 text-xs font-bold rounded-full border transition-all inline-flex items-center gap-1.5 cursor-pointer shadow-sm ${
                    ehServidor
                    ? "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200"
                    : "bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200"
                }">
                    <i class="fa-solid ${ehServidor ? 'fa-building-columns' : 'fa-id-badge'}"></i>
                    <span>${ehServidor ? 'Servidor' : 'Terceirizado'}</span>
                    <i class="fa-solid fa-repeat text-[10px] ml-0.5 opacity-70"></i>
                </button>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-bold text-blue-600">${p.plantoes}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
                <button onclick="toggleParticipantStatus('${nomeEscapado}', ${!p.ativo})" class="px-3 py-1 text-xs font-bold rounded-full border transition-all ${
                    p.ativo 
                    ? "bg-green-100 text-green-800 border-green-200 hover:bg-green-200" 
                    : "bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200"
                }">
                    ${p.ativo ? '<i class="fa-solid fa-circle-check mr-1"></i>Ativo' : '<i class="fa-solid fa-circle-minus mr-1"></i>Inativo'}
                </button>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center text-sm space-x-3">
                <button onclick="abrirModalEditarParticipante('${nomeEscapado}')" class="text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center space-x-1 transition-colors" title="Editar nome do participante">
                    <i class="fa-solid fa-user-pen"></i>
                    <span>Editar</span>
                </button>
                <button onclick="confirmRemoveParticipant('${nomeEscapado}')" class="text-red-500 hover:text-red-700 font-semibold inline-flex items-center space-x-1 transition-colors" title="Excluir participante">
                    <i class="fa-solid fa-trash"></i>
                    <span>Excluir</span>
                </button>
            </td>
        `;
        listBody.appendChild(tr);
    });
}

function abrirModalEditarParticipante(nome) {
    const modal = document.getElementById("modal-editar-participante");
    const inputAntigo = document.getElementById("edit-nome-antigo");
    const inputNome = document.getElementById("input-edit-nome");
    if (!modal || !inputAntigo || !inputNome) return;

    inputAntigo.value = nome;
    inputNome.value = nome;
    modal.classList.remove("hidden");
    setTimeout(() => {
        inputNome.focus();
        inputNome.select();
    }, 50);
}

function fecharModalEditarParticipante() {
    const modal = document.getElementById("modal-editar-participante");
    if (modal) modal.classList.add("hidden");
}

function salvarEdicaoNomeParticipante(event) {
    if (event) event.preventDefault();
    const inputAntigo = document.getElementById("edit-nome-antigo");
    const inputNovo = document.getElementById("input-edit-nome");
    if (!inputAntigo || !inputNovo) return;

    const antigoNome = inputAntigo.value;
    const novoNome = inputNovo.value.trim();

    if (!novoNome) {
        showToast("Digite um nome válido para o participante.", "warning");
        return;
    }
    if (novoNome === antigoNome) {
        fecharModalEditarParticipante();
        return;
    }
    if (db.participantes[novoNome]) {
        showToast(`Já existe outro participante cadastrado com o nome "${novoNome}".`, "error");
        return;
    }

    editarNomeParticipante(antigoNome, novoNome);
    fecharModalEditarParticipante();
}

function editarNomeParticipante(antigoNome, novoNome) {
    if (!db.participantes[antigoNome]) return;

    // 1. Preservar dados e transferir para a nova chave
    db.participantes[novoNome] = { ...db.participantes[antigoNome] };
    delete db.participantes[antigoNome];

    // 2. Atualizar na escala proposta atual em memória (se houver)
    if (escalaPropostaGlobal && typeof escalaPropostaGlobal === "object") {
        Object.keys(escalaPropostaGlobal).forEach(dia => {
            const slot = escalaPropostaGlobal[dia];
            if (typeof slot === "object" && slot !== null) {
                if (slot.servidor === antigoNome) slot.servidor = novoNome;
                if (slot.terceirizado === antigoNome) slot.terceirizado = novoNome;
            } else if (slot === antigoNome) {
                escalaPropostaGlobal[dia] = novoNome;
            }
        });
    }

    // 3. Atualizar no histórico de escalas salvas
    if (Array.isArray(db.historico_escalas)) {
        db.historico_escalas.forEach(h => {
            if (h.escala && typeof h.escala === "object") {
                Object.keys(h.escala).forEach(dia => {
                    const slot = h.escala[dia];
                    if (typeof slot === "object" && slot !== null) {
                        if (slot.servidor === antigoNome) slot.servidor = novoNome;
                        if (slot.terceirizado === antigoNome) slot.terceirizado = novoNome;
                    } else if (slot === antigoNome) {
                        h.escala[dia] = novoNome;
                    }
                });
            }
        });
    }

    // 4. Salvar e re-renderizar todas as telas
    saveData();
    renderAll();
    recuperarUltimaEscalaNaTela();
    showToast(`Nome alterado de "${antigoNome}" para "${novoNome}" com sucesso!`, "success");
}

function confirmRemoveParticipant(nome) {
    if (confirm(`Deseja realmente remover o participante "${nome}"? Todo o saldo de plantões acumulado por ele será excluído.`)) {
        removeParticipant(nome);
    }
}

function renderDisponibilidades() {
    const listBody = document.getElementById("lista-disponibilidades");
    const avisoVazio = document.getElementById("aviso-sem-participantes");
    const btnGerar = document.getElementById("gerar-escala-btn");
    if (!listBody || !avisoVazio) return;
    
    listBody.innerHTML = "";
    
    const ativos = Object.keys(db.participantes)
        .filter(nome => db.participantes[nome].ativo)
        .sort((a, b) => {
            const tipoA = db.participantes[a].tipo || "servidor";
            const tipoB = db.participantes[b].tipo || "servidor";
            if (tipoA !== tipoB) return tipoA.localeCompare(tipoB);
            return a.localeCompare(b);
        });

    if (ativos.length === 0) {
        avisoVazio.classList.remove("hidden");
        if (btnGerar) {
            btnGerar.disabled = true;
            btnGerar.classList.add("opacity-50", "cursor-not-allowed");
        }
        return;
    } else {
        avisoVazio.classList.add("hidden");
        if (btnGerar) {
            btnGerar.disabled = false;
            btnGerar.classList.remove("opacity-50", "cursor-not-allowed");
        }
    }

    const dias = DIAS_PLANTAO;

    ativos.forEach(nome => {
        const p = db.participantes[nome];
        const ehServidor = (p.tipo === "servidor");
        const tr = document.createElement("tr");
        tr.className = "hover:bg-gray-50 transition-colors";
        
        let htmlCheckboxes = "";
        dias.forEach(dia => {
            const estaDisponivel = p.disponibilidade ? p.disponibilidade.includes(dia) : true;
            htmlCheckboxes += `
                <td class="px-6 py-4 whitespace-nowrap text-center">
                    <input type="checkbox" id="disp-${nome}-${dia}" ${estaDisponivel ? 'checked' : ''} class="h-4.5 w-4.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer">
                </td>
            `;
        });

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">${nome}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold inline-flex items-center gap-1 ${
                    ehServidor ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                }">
                    <i class="fa-solid ${ehServidor ? 'fa-building-columns' : 'fa-id-badge'} text-[10px]"></i>
                    ${ehServidor ? 'Servidor' : 'Terceirizado'}
                </span>
            </td>
            ${htmlCheckboxes}
            <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-semibold text-gray-600">${p.plantoes} plantões</td>
        `;
        listBody.appendChild(tr);
    });
}

function renderHistorico() {
    const container = document.getElementById("lista-historico-escalas");
    const avisoVazio = document.getElementById("aviso-historico-vazio");
    if (!container || !avisoVazio) return;
    
    container.innerHTML = "";
    
    if (db.historico_escalas.length === 0) {
        avisoVazio.classList.remove("hidden");
        return;
    } else {
        avisoVazio.classList.add("hidden");
    }

    const dias = DIAS_PLANTAO;

    db.historico_escalas.forEach((h, index) => {
        const div = document.createElement("div");
        div.className = "bg-gray-50 border border-gray-200 rounded-xl p-5 shadow-sm";
        
        const diasComDatas = getDaysOfWeekWithDates(h.semana) || {};
        
        let linhasTabela = "";
        dias.forEach(dia => {
            const item = h.escala[dia];
            let servNome = "";
            let tercNome = "";

            if (typeof item === "object" && item !== null) {
                servNome = item.servidor;
                tercNome = item.terceirizado;
            } else if (typeof item === "string") {
                servNome = item;
                tercNome = "—";
            }

            function formatBadge(nome, tipo) {
                if (nome === "FERIADO") {
                    return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300"><i class="fa-solid fa-umbrella-beach text-xs"></i> Feriado</span>';
                }
                if (nome) {
                    const icon = tipo === "servidor" ? "fa-building-columns text-blue-600" : "fa-id-badge text-purple-600";
                    return `<span class="inline-flex items-center gap-1.5 font-bold text-gray-900"><i class="fa-solid ${icon} text-xs"></i>${nome}</span>`;
                }
                return '<span class="text-red-500 font-bold text-xs"><i class="fa-solid fa-circle-xmark mr-1"></i>VAGO</span>';
            }

            linhasTabela += `
                <tr class="border-b border-gray-100 last:border-0 hover:bg-white/60 transition-colors">
                    <td class="py-2.5 font-bold text-xs text-gray-700 w-1/3">${diasComDatas[dia] || dia}</td>
                    <td class="py-2.5 text-xs w-1/3">${formatBadge(servNome, "servidor")}</td>
                    <td class="py-2.5 text-xs w-1/3">${formatBadge(tercNome, "terceirizado")}</td>
                </tr>
            `;
        });

        div.innerHTML = `
            <div class="flex items-center justify-between border-b border-gray-200 pb-3 mb-3">
                <h3 class="text-base font-bold text-gray-900 flex items-center space-x-2">
                    <i class="fa-solid fa-calendar-week text-indigo-500"></i>
                    <span>${h.semanaTexto}</span>
                </h3>
                <button onclick="confirmDeletarHistorico(${index})" class="text-red-600 hover:text-red-800 text-xs font-semibold flex items-center space-x-1 transition-all">
                    <i class="fa-solid fa-trash-can"></i>
                    <span>Apagar Escala</span>
                </button>
            </div>
            <table class="w-full text-left">
                <thead>
                    <tr class="text-[11px] uppercase tracking-wider text-gray-400 font-bold border-b border-gray-200">
                        <th class="pb-1.5">Dia</th>
                        <th class="pb-1.5">Servidor</th>
                        <th class="pb-1.5">Terceirizado</th>
                    </tr>
                </thead>
                <tbody>
                    ${linhasTabela}
                </tbody>
            </table>
        `;
        container.appendChild(div);
    });
}

function confirmDeletarHistorico(index) {
    if (confirm("Você deseja realmente excluir esta escala? Os plantões contabilizados para ambos os profissionais serão deduzidos de seus saldos acumulados.")) {
        const item = db.historico_escalas[index];
        
        Object.values(item.escala).forEach(ponto => {
            if (typeof ponto === "object" && ponto !== null) {
                if (ponto.servidor && ponto.servidor !== "FERIADO" && db.participantes[ponto.servidor]) {
                    db.participantes[ponto.servidor].plantoes = Math.max(0, db.participantes[ponto.servidor].plantoes - 1);
                }
                if (ponto.terceirizado && ponto.terceirizado !== "FERIADO" && db.participantes[ponto.terceirizado]) {
                    db.participantes[ponto.terceirizado].plantoes = Math.max(0, db.participantes[ponto.terceirizado].plantoes - 1);
                }
            } else if (typeof ponto === "string" && ponto !== "FERIADO" && db.participantes[ponto]) {
                db.participantes[ponto].plantoes = Math.max(0, db.participantes[ponto].plantoes - 1);
            }
        });

        db.historico_escalas.splice(index, 1);
        saveData();
        renderAll();
        showToast("Escala apagada com sucesso e saldos recalculados.", "success");
    }
}

// --- UTILS DE DATA E SEMANA (SEGUNDA A QUINTA) ---

function getDatesOfWeek(weekStr) {
    if (!weekStr) return null;
    const parts = weekStr.split("-W");
    if (parts.length !== 2) return null;
    
    const year = parseInt(parts[0], 10);
    const week = parseInt(parts[1], 10);
    
    const jan4 = new Date(year, 0, 4);
    const day = jan4.getDay() || 7;
    const monW1 = new Date(jan4.getTime());
    monW1.setDate(jan4.getDate() - (day - 1));
    
    const monday = new Date(monW1.getTime());
    monday.setDate(monW1.getDate() + (week - 1) * 7);
    
    const thursday = new Date(monday.getTime());
    thursday.setDate(monday.getDate() + 3);
    
    return {
        monday: monday,
        thursday: thursday,
        formatted: `do dia ${formatDateShort(monday)} ao dia ${formatDateShort(thursday)}`
    };
}

function formatDateShort(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
}

function getDaysOfWeekWithDates(weekStr) {
    const dates = getDatesOfWeek(weekStr);
    if (!dates) return null;
    
    const dias = DIAS_PLANTAO;
    const resultado = {};
    
    for (let i = 0; i < dias.length; i++) {
        const d = new Date(dates.monday.getTime());
        d.setDate(dates.monday.getDate() + i);
        resultado[dias[i]] = `${dias[i]} - ${formatDateShort(d)}`;
    }
    return resultado;
}

function inicializarDataSemana() {
    const inputSemana = document.getElementById("semana-selecionada");
    if (inputSemana) {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        
        const target = new Date(hoje.valueOf());
        const dayNr = (hoje.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNr + 3);
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
        }
        const weekNum = 1 + Math.ceil((firstThursday - target) / 604800000);
        
        const semanaPadrao = `${ano}-W${String(weekNum).padStart(2, "0")}`;
        inputSemana.value = semanaPadrao;
        atualizarTextoSemana();
    }
    
    const dataHeader = document.getElementById("data-atual");
    if (dataHeader) {
        const opcoes = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dataHeader.textContent = new Date().toLocaleDateString('pt-BR', opcoes);
    }
}

let calAnoAtual = new Date().getFullYear();
let calMesAtual = new Date().getMonth();

function atualizarTextoSemana() {
    const inputSemana = document.getElementById("semana-selecionada");
    const textoIntervalo = document.getElementById("texto-intervalo-semana");
    const labelDisplay = document.getElementById("label-semana-display");
    
    if (inputSemana) {
        const val = inputSemana.value; // ex: 2026-W38
        const datas = getDatesOfWeek(val);
        
        if (labelDisplay) {
            const parts = val.split("-W");
            if (parts.length === 2) {
                labelDisplay.textContent = `Semana ${parseInt(parts[1], 10)}, ${parts[0]}`;
            } else {
                labelDisplay.textContent = val || "Selecione a Semana";
            }
        }
        
        if (textoIntervalo) {
            if (datas) {
                textoIntervalo.innerHTML = `<i class="fa-regular fa-calendar-days mr-1.5"></i> ${datas.formatted}`;
                textoIntervalo.classList.remove("hidden");
            } else {
                textoIntervalo.classList.add("hidden");
            }
        }
    }
}

// --- POPUP DO CALENDÁRIO VISUAL DE SEMANAS ---

function alternarCalendarioSemana(event) {
    if (event) event.stopPropagation();
    const popup = document.getElementById("popup-calendario-semana");
    if (!popup) return;

    if (popup.classList.contains("hidden")) {
        abrirCalendarioSemana();
    } else {
        fecharCalendarioSemana();
    }
}

function abrirCalendarioSemana() {
    const popup = document.getElementById("popup-calendario-semana");
    if (!popup) return;

    const inputSemana = document.getElementById("semana-selecionada");
    if (inputSemana && inputSemana.value) {
        const datas = getDatesOfWeek(inputSemana.value);
        if (datas && datas.monday) {
            calAnoAtual = datas.monday.getFullYear();
            calMesAtual = datas.monday.getMonth();
        }
    }

    renderizarCalendarioPopup(calAnoAtual, calMesAtual);
    popup.classList.remove("hidden");
}

function fecharCalendarioSemana() {
    const popup = document.getElementById("popup-calendario-semana");
    if (popup) popup.classList.add("hidden");
}

function mudarMesCalendario(delta) {
    calMesAtual += delta;
    if (calMesAtual > 11) {
        calMesAtual = 0;
        calAnoAtual++;
    } else if (calMesAtual < 0) {
        calMesAtual = 11;
        calAnoAtual--;
    }
    renderizarCalendarioPopup(calAnoAtual, calMesAtual);
}

function getIsoWeekFromDate(d) {
    const target = new Date(d.valueOf());
    const dayNr = (d.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    const weekNum = 1 + Math.ceil((firstThursday - target) / 604800000);
    const ano = target.getFullYear();
    return {
        weekNum: weekNum,
        ano: ano,
        semanaStr: `${ano}-W${String(weekNum).padStart(2, "0")}`
    };
}

function renderizarCalendarioPopup(ano, mes) {
    const titulo = document.getElementById("calendario-titulo-mes-ano");
    const corpo = document.getElementById("calendario-corpo-dias");
    if (!titulo || !corpo) return;

    const nomesMeses = [
        "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
        "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ];
    titulo.textContent = `${nomesMeses[mes]} de ${ano}`;

    corpo.innerHTML = "";

    const primeiroDiaMes = new Date(ano, mes, 1);
    const ultimoDiaMes = new Date(ano, mes + 1, 0);

    let diaSemanaPrimeiro = primeiroDiaMes.getDay();
    if (diaSemanaPrimeiro === 0) diaSemanaPrimeiro = 7; // Domingo vira 7

    const inicioCalendario = new Date(ano, mes, 1);
    inicioCalendario.setDate(primeiroDiaMes.getDate() - (diaSemanaPrimeiro - 1));

    const inputSemana = document.getElementById("semana-selecionada");
    const semanaSelecionadaAtual = inputSemana ? inputSemana.value : "";

    let cursorData = new Date(inicioCalendario.getTime());
    let semanasRenderizadas = 0;

    while (semanasRenderizadas < 6) {
        if (cursorData > ultimoDiaMes && cursorData.getDay() === 1 && semanasRenderizadas >= 4) {
            break;
        }

        const semanaIsoInfo = getIsoWeekFromDate(cursorData);
        const ehSemanaSelecionada = (semanaIsoInfo.semanaStr === semanaSelecionadaAtual);

        const tr = document.createElement("tr");
        tr.className = `group cursor-pointer rounded-lg transition-all ${
            ehSemanaSelecionada 
            ? "bg-blue-100 font-bold text-blue-900 border border-blue-300" 
            : "hover:bg-blue-50 text-gray-700"
        }`;
        tr.title = `Clique para selecionar a Semana ${semanaIsoInfo.weekNum}`;
        tr.onclick = (e) => {
            e.stopPropagation();
            selecionarSemanaPeloCalendario(semanaIsoInfo.semanaStr);
        };

        // Coluna número da semana
        let htmlLinha = `
            <td class="py-2 px-1 text-[11px] font-extrabold ${ehSemanaSelecionada ? 'text-blue-700' : 'text-blue-500 group-hover:text-blue-700'}">
                ${semanaIsoInfo.weekNum}
            </td>
        `;

        // 7 dias da semana (Segunda a Domingo)
        for (let d = 0; d < 7; d++) {
            const ehMesAtual = (cursorData.getMonth() === mes);
            const ehPlantao = (d < 4); // Seg, Ter, Qua, Qui
            const diaNum = cursorData.getDate();

            let classesDia = "py-2 px-1 text-xs ";
            if (!ehMesAtual) {
                classesDia += "text-gray-300 ";
            } else if (ehPlantao) {
                classesDia += ehSemanaSelecionada ? "font-extrabold text-blue-900 " : "font-semibold text-gray-800 ";
            } else {
                classesDia += "text-gray-400 ";
            }

            htmlLinha += `<td class="${classesDia}">${diaNum}</td>`;
            cursorData.setDate(cursorData.getDate() + 1);
        }

        tr.innerHTML = htmlLinha;
        corpo.appendChild(tr);
        semanasRenderizadas++;
    }
}

function selecionarSemanaPeloCalendario(semanaStr) {
    const inputSemana = document.getElementById("semana-selecionada");
    if (inputSemana) {
        inputSemana.value = semanaStr;
        atualizarTextoSemana();
    }
    fecharCalendarioSemana();

    // Se já houver escala salva no histórico para esta semana, exibe nos cards da tela
    const escalaSalva = db.historico_escalas.find(h => h.semana === semanaStr);
    if (escalaSalva) {
        escalaPropostaGlobal = JSON.parse(JSON.stringify(escalaSalva.escala));
        semanaPropostaGlobal = escalaSalva.semana;
        exibirCardsEscala(semanaPropostaGlobal, escalaPropostaGlobal);
    }
}

function selecionarSemanaHoje() {
    const hoje = new Date();
    const info = getIsoWeekFromDate(hoje);
    selecionarSemanaPeloCalendario(info.semanaStr);
}

// Fechar popup se clicar fora dele
document.addEventListener("click", (e) => {
    const popup = document.getElementById("popup-calendario-semana");
    const container = document.getElementById("container-seletor-semana");
    const badge = document.getElementById("texto-intervalo-semana");
    if (popup && !popup.classList.contains("hidden")) {
        if (container && !container.contains(e.target) && badge && !badge.contains(e.target)) {
            fecharCalendarioSemana();
        }
    }
});

function salvarDisponibilidades() {
    const ativos = Object.keys(db.participantes).filter(nome => db.participantes[nome].ativo);
    const dias = DIAS_PLANTAO;
    
    ativos.forEach(nome => {
        const disp = [];
        dias.forEach(dia => {
            const check = document.getElementById(`disp-${nome}-${dia}`);
            if (check && check.checked) {
                disp.push(dia);
            }
        });
        db.participantes[nome].disponibilidade = disp;
    });
    
    saveData();
    showToast("Disponibilidades salvas com sucesso!", "success");
}

function limparDisponibilidades() {
    const ativos = Object.keys(db.participantes).filter(nome => db.participantes[nome].ativo);
    const dias = DIAS_PLANTAO;
    
    ativos.forEach(nome => {
        dias.forEach(dia => {
            const check = document.getElementById(`disp-${nome}-${dia}`);
            if (check) check.checked = false;
        });
    });

    dias.forEach(dia => {
        const checkFeriado = document.getElementById(`feriado-${dia}`);
        if (checkFeriado) checkFeriado.checked = false;
    });

    showToast("Campos limpos! Suas marcações salvas anteriormente continuam intactas no banco.", "success");
}

function switchTab(tabId) {
    const tabs = ["escala", "participantes", "historico"];
    tabs.forEach(t => {
        const section = document.getElementById(`tab-${t}`);
        const btn = document.getElementById(`tab-${t}-btn`);
        
        if (t === tabId) {
            if (section) section.classList.remove("hidden");
            if (btn) btn.className = "tab-active py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-all";
        } else {
            if (section) section.classList.add("hidden");
            if (btn) btn.className = "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-all";
        }
    });
}

function showToast(mensagem, tipo = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `p-4 rounded-lg shadow-lg border text-white font-medium text-sm flex items-center space-x-2 transition-all duration-300 translate-y-2 opacity-0`;
    
    if (tipo === "success") {
        toast.classList.add("bg-emerald-600", "border-emerald-500");
        toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>${mensagem}</span>`;
    } else if (tipo === "error") {
        toast.classList.add("bg-red-600", "border-red-500");
        toast.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>${mensagem}</span>`;
    } else {
        toast.classList.add("bg-blue-600", "border-blue-500");
        toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span>${mensagem}</span>`;
    }

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove("translate-y-2", "opacity-0");
    }, 10);

    setTimeout(() => {
        toast.classList.add("opacity-0");
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

// --- IMPORTAR / EXPORTAR BACKUP JSON ---

function downloadBackup() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `backup_escala_plantao_${new Date().toISOString().slice(0,10)}.json`);
    dlAnchorElem.click();
    showToast("Backup baixado com sucesso!", "success");
}

function uploadBackup(event) {
    const input = event.target;
    const reader = new FileReader();
    
    reader.onload = function(){
        try {
            const backupDb = JSON.parse(reader.result);
            if (backupDb && typeof backupDb === 'object' && backupDb.participantes && backupDb.historico_escalas) {
                if (confirm("Você deseja restaurar estes dados de backup? Os participantes e históricos atuais serão totalmente substituídos.")) {
                    db = backupDb;
                    Object.keys(db.participantes).forEach(nome => {
                        if (!db.participantes[nome].tipo) db.participantes[nome].tipo = "servidor";
                        if (!db.participantes[nome].disponibilidade) db.participantes[nome].disponibilidade = [...DIAS_PLANTAO];
                    });
                    saveData();
                    renderAll();
                    showToast("Dados do backup restaurados com sucesso!", "success");
                }
            } else {
                showToast("Arquivo de backup inválido. Chaves não correspondem à estrutura correta.", "error");
            }
        } catch (e) {
            showToast("Erro ao ler o arquivo JSON. Certifique-se de carregar um backup válido.", "error");
        }
        input.value = "";
    };
    
    if (input.files.length > 0) {
        reader.readAsText(input.files[0]);
    }
}

// Fechar modais ao pressionar tecla Escape
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        fecharModalEditarParticipante();
        fecharModalFirebaseConfig();
        fecharCalendarioSemana();
    }
});
