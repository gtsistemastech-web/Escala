// Banco de dados em memória local, sincronizado com LocalStorage
let db = {
    participantes: {},
    historico_escalas: []
};

// Escala proposta temporária (ainda não gravada)
let escalaPropostaGlobal = null;
let semanaPropostaGlobal = "";

// Inicialização da página
document.addEventListener("DOMContentLoaded", () => {
    loadData();
    inicializarDataSemana();
    renderAll();
    
    // Form de cadastro
    const formCadastro = document.getElementById("form-cadastro");
    if (formCadastro) {
        formCadastro.addEventListener("submit", (e) => {
            e.preventDefault();
            const inputNome = document.getElementById("nome-participante");
            const nome = inputNome.value.trim();
            if (nome) {
                const cadastrado = addParticipant(nome);
                if (cadastrado) {
                    inputNome.value = "";
                    renderAll();
                    showToast(`Participante "${nome}" adicionado com sucesso!`, "success");
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
            // Garantir chaves básicas
            if (!db.participantes) db.participantes = {};
            if (!db.historico_escalas) db.historico_escalas = [];
            // Garantir propriedade disponibilidade
            Object.keys(db.participantes).forEach(nome => {
                if (!db.participantes[nome].disponibilidade) {
                    db.participantes[nome].disponibilidade = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
                }
            });
        } catch (e) {
            console.error("Erro ao carregar dados do LocalStorage, resetando banco local.", e);
            db = { participantes: {}, historico_escalas: [] };
        }
    } else {
        // Dados de exemplo iniciais para demonstração se estiver vazio
        db = {
            participantes: {
                "Gustavo": { plantoes: 0, ativo: true, disponibilidade: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"] },
                "Valeria": { plantoes: 0, ativo: true, disponibilidade: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"] },
                "Carlos": { plantoes: 0, ativo: true, disponibilidade: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"] },
                "Beatriz": { plantoes: 0, ativo: true, disponibilidade: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"] },
                "Daniel": { plantoes: 0, ativo: true, disponibilidade: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"] },
                "Eduarda": { plantoes: 0, ativo: true, disponibilidade: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"] },
                "Fernanda": { plantoes: 0, ativo: true, disponibilidade: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"] }
            },
            historico_escalas: []
        };
        saveData();
    }
}

function saveData() {
    localStorage.setItem("plantao_noturno_db", JSON.stringify(db));
}

// --- CONTROLE DE PARTICIPANTES ---

function addParticipant(nome) {
    if (db.participantes[nome]) {
        showToast(`Participante "${nome}" já está cadastrado.`, "error");
        return false;
    }
    db.participantes[nome] = {
        plantoes: 0,
        ativo: true,
        disponibilidade: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"]
    };
    saveData();
    return true;
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

// --- ALGORITMO DE AGENDAMENTO (BACKTRACKING + JUSTIÇA) ---

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function solveSchedule(disponibilidades) {
    const ativos = {};
    for (const [nome, dados] of Object.entries(db.participantes)) {
        if (dados.ativo) {
            ativos[nome] = dados;
        }
    }
    
    const dias = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
    
    // Mapear candidatos por dia
    const candidatosPorDia = {
        "Segunda": [],
        "Terça": [],
        "Quarta": [],
        "Quinta": [],
        "Sexta": []
    };
    
    for (const [nome, diasDisponiveis] of Object.entries(disponibilidades)) {
        if (ativos[nome]) {
            for (const dia of diasDisponiveis) {
                if (candidatosPorDia[dia]) {
                    candidatosPorDia[dia].push(nome);
                }
            }
        }
    }
    
    // Para cada dia, ordenar os candidatos por saldo de plantão
    // com desempate aleatório para não favorecer nomes em ordem alfabética.
    for (const dia of dias) {
        let candidatos = candidatosPorDia[dia];
        candidatos = shuffleArray(candidatos);
        candidatos.sort((a, b) => ativos[a].plantoes - ativos[b].plantoes);
        candidatosPorDia[dia] = candidatos;
    }
    
    let bestSchedule = {
        "Segunda": null,
        "Terça": null,
        "Quarta": null,
        "Quinta": null,
        "Sexta": null
    };
    let bestScore = -1;
    
    // Backtracking recursivo para buscar a escala com maior pontuação global
    function backtrack(diaIdx, currentSchedule, currentUsedPeople) {
        if (diaIdx === dias.length) {
            // Pontuação da escala atual:
            // 1. Cada dia preenchido adiciona 100.000 pontos.
            // 2. Prioriza participantes com menor saldo de plantão acumulado.
            let score = 0;
            for (const dia of dias) {
                const p = currentSchedule[dia];
                if (p) {
                    score += 100000 - ativos[p].plantoes;
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestSchedule = { ...currentSchedule };
            }
            return;
        }
        
        const dia = dias[diaIdx];
        const candidatos = candidatosPorDia[dia] || [];
        let alocouAlguem = false;
        
        for (const p of candidatos) {
            if (!currentUsedPeople.has(p)) {
                currentSchedule[dia] = p;
                currentUsedPeople.add(p);
                
                backtrack(diaIdx + 1, currentSchedule, currentUsedPeople);
                
                // Desfazer escolha para backtracking
                currentUsedPeople.delete(p);
                currentSchedule[dia] = null;
                alocouAlguem = true;
            }
        }
        
        // Se ninguém puder ser alocado neste dia por causa de restrições ou se a lista for vazia,
        // deixa o dia vago e prossegue.
        if (!alocouAlguem || candidatos.length === 0) {
            currentSchedule[dia] = null;
            backtrack(diaIdx + 1, currentSchedule, currentUsedPeople);
            currentSchedule[dia] = null;
        }
    }
    
    backtrack(0, {
        "Segunda": null,
        "Terça": null,
        "Quarta": null,
        "Quinta": null,
        "Sexta": null
    }, new Set());
    
    // Gerar alertas de dias que ficaram vagos
    const alertas = [];
    for (const dia of dias) {
        if (!bestSchedule[dia]) {
            alertas.push(`Aviso: Não foi possível alocar ninguém para a <strong>${dia}</strong>. Nenhum participante livre estava disponível para este dia.`);
        }
    }
    
    return { escala: bestSchedule, alertas };
}

// Execução da geração de escala na Interface
function gerarEscalaSemanal() {
    const ativos = Object.keys(db.participantes).filter(nome => db.participantes[nome].ativo);
    if (ativos.length === 0) {
        showToast("Cadastre e ative pelo menos 1 participante antes de gerar a escala.", "error");
        return;
    }

    const inputSemana = document.getElementById("semana-selecionada");
    semanaPropostaGlobal = inputSemana.value;
    if (!semanaPropostaGlobal) {
        showToast("Por favor, selecione a semana do plantão.", "error");
        return;
    }

    // Coletar disponibilidades temporárias da tabela
    const disponibilidades = {};
    const dias = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
    
    ativos.forEach(nome => {
        disponibilidades[nome] = [];
        dias.forEach(dia => {
            const check = document.getElementById(`disp-${nome}-${dia}`);
            if (check && check.checked) {
                disponibilidades[nome].push(dia);
            }
        });
    });

    // Rodar algoritmo
    const resultado = solveSchedule(disponibilidades);
    escalaPropostaGlobal = resultado.escala;

    // Exibir Alertas se houver
    const containerAlertas = document.getElementById("container-alertas-escala");
    const listaAlertas = document.getElementById("lista-alertas-escala");
    
    if (resultado.alertas.length > 0) {
        containerAlertas.classList.remove("hidden");
        listaAlertas.innerHTML = resultado.alertas.map(a => `<li>${a}</li>`).join("");
    } else {
        containerAlertas.classList.add("hidden");
        listaAlertas.innerHTML = "";
    }

    // Exibir Escala Resultante
    const secaoResultado = document.getElementById("secao-resultado-escala");
    const cardsContainer = document.getElementById("escala-cards-container");
    cardsContainer.innerHTML = "";

    const diasComDatas = getDaysOfWeekWithDates(semanaPropostaGlobal) || {};

    dias.forEach(dia => {
        const pessoa = escalaPropostaGlobal[dia];
        const card = document.createElement("div");
        card.className = `p-4 rounded-lg border shadow-sm flex flex-col items-center justify-center text-center transition-all ${
            pessoa ? "bg-blue-50 border-blue-200" : "bg-red-50 border-red-200 text-red-700"
        }`;
        
        card.innerHTML = `
            <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">${diasComDatas[dia] || dia}</span>
            <div class="my-2">
                <i class="${pessoa ? "fa-solid fa-user-shield text-blue-600 text-2xl" : "fa-solid fa-circle-xmark text-red-500 text-2xl"}"></i>
            </div>
            <span class="text-base font-bold text-gray-900">${pessoa || "VAGO"}</span>
            <span class="text-xs text-gray-400 mt-1">${pessoa ? `Saldo: ${db.participantes[pessoa].plantoes} plantões` : "Sem alocação"}</span>
        `;
        cardsContainer.appendChild(card);
    });

    secaoResultado.classList.remove("hidden");
    secaoResultado.scrollIntoView({ behavior: 'smooth' });
    showToast("Escala sugerida gerada com sucesso!", "success");
}

function confirmarESalvarEscala() {
    if (!escalaPropostaGlobal || !semanaPropostaGlobal) {
        showToast("Nenhuma escala pendente para confirmação.", "error");
        return;
    }

    // Formatar identificação da semana de forma legível (ex: "Semana 35 (do dia 24/08/2026 ao dia 28/08/2026)")
    const parts = semanaPropostaGlobal.split("-W");
    const datas = getDatesOfWeek(semanaPropostaGlobal);
    const intervaloTexto = datas ? ` (${datas.formatted})` : "";
    const semanaTexto = parts.length === 2 ? `Semana ${parts[1]} de ${parts[0]}${intervaloTexto}` : semanaPropostaGlobal;

    // Verificar se já existe escala cadastrada para essa semana no histórico
    const existeIndex = db.historico_escalas.findIndex(h => h.semana === semanaPropostaGlobal);
    if (existeIndex !== -1) {
        if (!confirm(`Já existe uma escala gravada para a ${semanaTexto}. Deseja sobrescrever os dados? Os saldos de plantões antigos serão recalculados.`)) {
            return;
        }
        // Sobrescrever: precisamos primeiro descontar o saldo das pessoas que foram alocadas nessa escala que será deletada
        const escalaAntiga = db.historico_escalas[existeIndex].escala;
        Object.values(escalaAntiga).forEach(nome => {
            if (nome && db.participantes[nome]) {
                db.participantes[nome].plantoes = Math.max(0, db.participantes[nome].plantoes - 1);
            }
        });
        db.historico_escalas.splice(existeIndex, 1);
    }

    // Adicionar +1 no saldo das pessoas da nova escala
    Object.values(escalaPropostaGlobal).forEach(nome => {
        if (nome && db.participantes[nome]) {
            db.participantes[nome].plantoes += 1;
        }
    });

    // Salvar no histórico
    db.historico_escalas.push({
        semana: semanaPropostaGlobal,
        semanaTexto: semanaTexto,
        escala: { ...escalaPropostaGlobal }
    });

    // Ordenar histórico por semana decrescente
    db.historico_escalas.sort((a, b) => b.semana.localeCompare(a.semana));

    saveData();
    escalaPropostaGlobal = null;
    semanaPropostaGlobal = "";

    // Resetar UI de resultado
    document.getElementById("secao-resultado-escala").classList.add("hidden");
    document.getElementById("container-alertas-escala").classList.add("hidden");
    
    renderAll();
    showToast("Escala de plantão confirmada e salva no banco!", "success");
}

// --- EXPORTAÇÃO PARA EXCEL (SHEETJS) ---

function exportarEscalaExcel() {
    if (!escalaPropostaGlobal) return;
    
    const parts = semanaPropostaGlobal.split("-W");
    const datas = getDatesOfWeek(semanaPropostaGlobal);
    const intervaloTexto = datas ? ` (${datas.formatted})` : "";
    const semanaTexto = parts.length === 2 ? `Semana ${parts[1]} de ${parts[0]}${intervaloTexto}` : semanaPropostaGlobal;

    const diasComDatas = getDaysOfWeekWithDates(semanaPropostaGlobal) || {};

    // Criar array de dados para a planilha
    const dadosExcel = [
        ["ESCALA DE PLANTÃO NOTURNO"],
        [semanaTexto.toUpperCase()],
        [],
        ["Dia da Semana", "Profissional Escalado"],
        [diasComDatas["Segunda"] || "Segunda-feira", escalaPropostaGlobal["Segunda"] || "VAGO"],
        [diasComDatas["Terça"] || "Terça-feira", escalaPropostaGlobal["Terça"] || "VAGO"],
        [diasComDatas["Quarta"] || "Quarta-feira", escalaPropostaGlobal["Quarta"] || "VAGO"],
        [diasComDatas["Quinta"] || "Quinta-feira", escalaPropostaGlobal["Quinta"] || "VAGO"],
        [diasComDatas["Sexta"] || "Sexta-feira", escalaPropostaGlobal["Sexta"] || "VAGO"]
    ];

    // Criar workbook e worksheet do SheetJS
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(dadosExcel);

    // Ajustar larguras das colunas
    ws["!cols"] = [
        { wch: 20 },
        { wch: 30 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Escala");
    
    // Nome do arquivo
    const nomeArquivo = `escala_plantao_${semanaPropostaGlobal}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);
    showToast(`Arquivo Excel exportado com sucesso: ${nomeArquivo}`, "success");
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
        const tr = document.createElement("tr");
        tr.className = "hover:bg-gray-50 transition-colors";
        
        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">${nome}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-bold text-blue-600">${p.plantoes}</td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
                <button onclick="toggleParticipantStatus('${nome}', ${!p.ativo})" class="px-3 py-1 text-xs font-bold rounded-full border transition-all ${
                    p.ativo 
                    ? "bg-green-100 text-green-800 border-green-200 hover:bg-green-200" 
                    : "bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200"
                }">
                    ${p.ativo ? '<i class="fa-solid fa-circle-check mr-1"></i>Ativo' : '<i class="fa-solid fa-circle-minus mr-1"></i>Inativo'}
                </button>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center text-sm">
                <button onclick="confirmRemoveParticipant('${nome}')" class="text-red-500 hover:text-red-700 font-semibold inline-flex items-center space-x-1">
                    <i class="fa-solid fa-trash"></i>
                    <span>Excluir</span>
                </button>
            </td>
        `;
        listBody.appendChild(tr);
    });
}

function confirmRemoveParticipant(nome) {
    if (confirm(`Deseja realmente remover o participante "${nome}"? Todo o saldo de plantões acumulado por ele será excluído.`)) {
        removeParticipant(nome);
    }
}

function renderDisponibilidades() {
    const listBody = document.getElementById("lista-disponibilidades");
    const avisoVazio = document.getElementById("aviso-sem-participantes");
    
    listBody.innerHTML = "";
    
    // Obter apenas participantes ativos
    const ativos = Object.keys(db.participantes)
        .filter(nome => db.participantes[nome].ativo)
        .sort();

    if (ativos.length === 0) {
        avisoVazio.classList.remove("hidden");
        document.getElementById("gerar-escala-btn").disabled = true;
        document.getElementById("gerar-escala-btn").classList.add("opacity-50", "cursor-not-allowed");
        return;
    } else {
        avisoVazio.classList.add("hidden");
        document.getElementById("gerar-escala-btn").disabled = false;
        document.getElementById("gerar-escala-btn").classList.remove("opacity-50", "cursor-not-allowed");
    }

    const dias = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];

    ativos.forEach(nome => {
        const p = db.participantes[nome];
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
            ${htmlCheckboxes}
            <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-semibold text-gray-500">${p.plantoes} plantões</td>
        `;
        listBody.appendChild(tr);
    });
}

function renderHistorico() {
    const container = document.getElementById("lista-historico-escalas");
    const avisoVazio = document.getElementById("aviso-historico-vazio");
    
    container.innerHTML = "";
    
    if (db.historico_escalas.length === 0) {
        avisoVazio.classList.remove("hidden");
        return;
    } else {
        avisoVazio.classList.add("hidden");
    }

    const dias = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];

    db.historico_escalas.forEach((h, index) => {
        const div = document.createElement("div");
        div.className = "bg-gray-50 border border-gray-200 rounded-xl p-5 shadow-sm";
        
        const diasComDatas = getDaysOfWeekWithDates(h.semana) || {};
        
        // Gerar linhas da tabela daquela semana
        let linhasTabela = "";
        dias.forEach(dia => {
            const pessoa = h.escala[dia];
            linhasTabela += `
                <tr class="border-b border-gray-100 last:border-0">
                    <td class="py-2.5 font-bold text-sm text-gray-700">${diasComDatas[dia] || dia}</td>
                    <td class="py-2.5 text-sm font-semibold ${pessoa ? "text-gray-900" : "text-red-500"}">
                        ${pessoa ? `<i class="fa-solid fa-user-shield text-blue-500 mr-1.5 text-xs"></i>${pessoa}` : '<i class="fa-solid fa-circle-xmark mr-1.5 text-xs"></i>VAGO'}
                    </td>
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
            <table class="w-full">
                <tbody>
                    ${linhasTabela}
                </tbody>
            </table>
        `;
        container.appendChild(div);
    });
}

function confirmDeletarHistorico(index) {
    if (confirm("Você deseja realmente excluir esta escala? Os plantões contabilizados para os profissionais serão deduzidos de seus saldos acumulados.")) {
        const item = db.historico_escalas[index];
        
        // Deduzir plantão de quem participou nessa escala
        Object.values(item.escala).forEach(nome => {
            if (nome && db.participantes[nome]) {
                db.participantes[nome].plantoes = Math.max(0, db.participantes[nome].plantoes - 1);
            }
        });

        // Remover do histórico
        db.historico_escalas.splice(index, 1);
        saveData();
        renderAll();
        showToast("Escala apagada com sucesso e saldos recalculados.", "success");
    }
}

// --- UTILS ---

function inicializarDataSemana() {
    const inputSemana = document.getElementById("semana-selecionada");
    if (inputSemana) {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        
        // Calcular número da semana ISO
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
    
    // Data textual no header
    const dataHeader = document.getElementById("data-atual");
    if (dataHeader) {
        const opcoes = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dataHeader.textContent = new Date().toLocaleDateString('pt-BR', opcoes);
    }
}

function switchTab(tabId) {
    const tabs = ["escala", "participantes", "historico"];
    tabs.forEach(t => {
        const section = document.getElementById(`tab-${t}`);
        const btn = document.getElementById(`tab-${t}-btn`);
        
        if (t === tabId) {
            section.classList.remove("hidden");
            btn.className = "tab-active py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-all";
        } else {
            section.classList.add("hidden");
            btn.className = "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 transition-all";
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
    }

    container.appendChild(toast);

    // Fade-in
    setTimeout(() => {
        toast.classList.remove("translate-y-2", "opacity-0");
    }, 10);

    // Auto-destruir depois de 4 segundos
    setTimeout(() => {
        toast.classList.add("opacity-0");
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

// --- FUNÇÕES DE IMPORTAR/EXPORTAR BACKUP JSON ---

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
        input.value = ""; // Limpa input
    };
    
    if (input.files.length > 0) {
        reader.readAsText(input.files[0]);
    }
}

// --- CONTROLE DE DATA DA SEMANA ---

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
    
    const friday = new Date(monday.getTime());
    friday.setDate(monday.getDate() + 4);
    
    return {
        monday: monday,
        friday: friday,
        formatted: `do dia ${formatDateShort(monday)} ao dia ${formatDateShort(friday)}`
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
    
    const dias = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
    const resultado = {};
    
    for (let i = 0; i < 5; i++) {
        const d = new Date(dates.monday.getTime());
        d.setDate(dates.monday.getDate() + i);
        resultado[dias[i]] = `${dias[i]} - ${formatDateShort(d)}`;
    }
    return resultado;
}

function atualizarTextoSemana() {
    const inputSemana = document.getElementById("semana-selecionada");
    const textoIntervalo = document.getElementById("texto-intervalo-semana");
    if (inputSemana && textoIntervalo) {
        const datas = getDatesOfWeek(inputSemana.value);
        if (datas) {
            textoIntervalo.innerHTML = `<i class="fa-regular fa-calendar-days mr-1.5"></i> ${datas.formatted}`;
            textoIntervalo.classList.remove("hidden");
        } else {
            textoIntervalo.classList.add("hidden");
        }
    }
}

function salvarDisponibilidades() {
    const ativos = Object.keys(db.participantes).filter(nome => db.participantes[nome].ativo);
    const dias = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
    
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
    const dias = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"];
    
    ativos.forEach(nome => {
        dias.forEach(dia => {
            const check = document.getElementById(`disp-${nome}-${dia}`);
            if (check) {
                check.checked = false;
            }
        });
    });
    showToast("Campos limpos! Suas marcações salvas anteriormente continuam intactas no banco.", "success");
}
