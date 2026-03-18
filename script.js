// Variables globales
    let db = {};
    let departments = [];
    let epcis = [];

    // Références DOM
    const deptSelect = document.getElementById('deptSelector');
    const epciSelect = document.getElementById('epciSelector');
    const loadingMessage = document.getElementById('loadingMessage');
    const displayTitle = document.getElementById('displayTitle');
    const displaySubtitle = document.getElementById('displaySubtitle');
    
    const CSV_FILE_PATH = 'donnees.csv'; 

// --- 1. FONCTION DE TRAITEMENT
    function processData(data) {
        // Réinitialisation des variables globales
        db = {};
        departments = [];
        epcis = [];
        
        if (!data || data.length === 0) {
            loadingMessage.innerText = "ERREUR: Fichier CSV vide ou mal structuré.";
            return;
        }

        // 1. Identification dynamique des colonnes d'indicateurs
        const firstRowKeys = Object.keys(data[0] || {});
        const identificationKeys = ['Code_Entite', 'Nom_Entite', 'Code_Parent', 'Annee'];
        const indicatorKeys = firstRowKeys.filter(key => !identificationKeys.includes(key));
        
        // 2. Groupement par Code_Entite (pour séparer chaque territoire)
        const groupedData = data.reduce((acc, row) => {
            const code = String(row.Code_Entite).trim();
            if (code === "" || code === "null" || code === "undefined") return acc; 
            
            if (!acc[code]) {
                acc[code] = [];
            }
            acc[code].push(row);
            return acc;
        }, {});

        // 3. Traitement de chaque entité : extraction directe des séries
        for (const code in groupedData) {
            const entite_df = groupedData[code];
            const firstRow = entite_df[0];
            
            // Détermination du type et du parent
            const rawParentCode = String(firstRow.Code_Parent || '').trim();
            const parent_code = (rawParentCode !== "") ? rawParentCode : null;
            const entite_type = parent_code ? 'EPCI' : 'Département';
            
            const entite_data = {
                'name': String(firstRow.Nom_Entite).trim(),
                'type': entite_type,
                'parentCode': parent_code,
                'years': [],
            };
            
            // Initialisation des tableaux de séries temporelles
            indicatorKeys.forEach(key => {
                entite_data[key] = [];
            });

            // 4. Remplissage direct des séries temporelles (lecture ligne par ligne)
            entite_df.forEach(row => {
                const year = parseInt(row.Annee);
                if (isNaN(year)) return;
                
                entite_data.years.push(year);
                
                // Remplissage des séries (GES_Agriculture, GES_Industrie, etc.)
                indicatorKeys.forEach(key => {
                    let value = parseFloat(row[key]);
                    // Stocke la valeur ou null si la cellule est vide
                    entite_data[key].push(isNaN(value) ? null : value);
                });
            });
            
            db[code] = entite_data;

            // Remplir les listes des sélecteurs
            if (entite_type === 'Département') {
                departments.push({ code: code, name: entite_data.name });
            } else {
                epcis.push({ code: code, deptCode: parent_code, name: entite_data.name });
            }
        }
        
        // Démarrer l'interface une fois les données prêtes
        initDashboard();
    }
	
    // --- 2. FONCTION DE CHARGEMENT ASYNCHRONE ---
    async function loadCSV() {
        loadingMessage.innerText = "Téléchargement en cours...";
        
        try {
            // Utilise FETCH pour récupérer le fichier depuis le serveur
            const response = await fetch(CSV_FILE_PATH);
            if (!response.ok) {
                throw new Error(`Erreur de réseau: ${response.status} (${response.statusText})`);
            }
            const csvText = await response.text();

            // Utilise Papa Parse pour analyser le texte CSV
            Papa.parse(csvText, {
                header: true, 
                // DynamicTyping est crucial ici pour que les colonnes d'indicateurs soient lues comme des nombres
                dynamicTyping: true, 
                skipEmptyLines: true,
                delimiter: ';', // Délimiteur supposé
                complete: function(results) {
                    processData(results.data);
                },
                error: function(error) {
                    loadingMessage.innerText = "Erreur de traitement du CSV.";
                    console.error("Papa Parse Error:", error);
                }
            });

        } catch (error) {
            loadingMessage.innerText = "ERREUR: Impossible de lire le fichier CSV. V\u00e9rifiez le chemin d'accès.";
            displayTitle.innerText = "Erreur de chargement";
            console.error("Fetch Error:", error);
        }
    }

    // --- 3. LOGIQUE D'INTERFACE ET DÉMARRAGE ---

    function updateEpciList(deptCode) {
        epciSelect.innerHTML = "";
        let defaultOpt = new Option(`--- Vue d'ensemble : ${db[deptCode].name} ---`, "ALL_DEPT");
        epciSelect.add(defaultOpt);

        const relatedEpcis = epcis.filter(e => e.deptCode === deptCode);
        relatedEpcis.forEach(e => {
            epciSelect.add(new Option(e.name, e.code));
        });
    }

 // --- Fonction globale pour le recalcul des totaux GES ---
    function recalculateTotals(graphDiv, traces) {
        
        // Récupérer toutes les traces de barres qui ne sont pas la trace de texte
        const barTraces = traces.filter(t => t.type === 'bar');
        // Utiliser la longueur du tableau 'x' de la première trace pour initialiser le total
        const totalEmissions = new Array(barTraces[0].x.length).fill(0); 

        // Calculer le nouveau total à partir des traces visibles
        barTraces.forEach((trace) => {
            // Uniquement si la trace est visible
            if (trace.visible !== 'legendonly') { 
                 trace.y.forEach((val, i) => {
                     if (val !== null) {
                         totalEmissions[i] += val;
                     }
                 });
            }
        });

        // Mise à jour de la trace de texte (textTrace)
        const newText = totalEmissions.map(t => t > 0 ? `<b>${t.toFixed(3)}</b>` : null);
        const newY = totalEmissions.map(t => t > 0 ? t * 1.05 : null);
        
        // Vérifier la trace existante par son nom unique
        const currentTraces = graphDiv.data;
        const textTraceIndex = currentTraces.findIndex(t => t.name === 'Total_Emissions');

        if (textTraceIndex > -1) {
            const update = {
                y: [newY],
                text: [newText]
            };
            // Mise à jour de la trace sans redessiner tout le graphique
            Plotly.restyle(graphDiv, update, textTraceIndex);
        }
    }


function updateDashboard(idToLoad) {
    let data;
    let years;
    
    if (idToLoad === "ALL_DEPT") {
        const currentDeptCode = deptSelect.value;
        data = db[currentDeptCode];
    } else {
        data = db[idToLoad];
    }
    
    if (!data) return;

    years = data.years;

    // Définition des variables de contexte
    const entityName = data.name;
    const entityType = data.type;
    
    // Mise à jour Titres principaux (Haut de page)
    document.getElementById('displayTitle').innerText = entityName;
    const badge = document.getElementById('displayBadge');
    badge.innerText = entityType;
    badge.className = entityType === "Département" ? "badge badge-dept" : "badge";
    displaySubtitle.innerText = `Analyse temporelle jusqu'à ${years[years.length - 1]} (${entityType})`;
    
    // Cacher le message de chargement si les données sont prêtes
    loadingMessage.style.display = 'none';
    
    // 1. Mise à jour de tous les noms (classe: territory-name-display)
    document.querySelectorAll('.territory-name-display').forEach(element => {
        element.textContent = entityName;
    });

    // 2. Mise à jour de tous les badges
    document.querySelectorAll('.territory-badge-display').forEach(element => {
        element.textContent = entityType;
        element.classList.remove('badge-dept', 'badge-epci'); // Nettoyage sécurisé
        element.classList.add('badge'); 
        
        if (entityType === 'Département') {
            element.classList.add('badge-dept');
        } else if (entityType === 'EPCI') {
            element.classList.add('badge-epci');
        }
        element.style.display = 'inline-block';
    });

        // --- DÉFINITION DU LAYOUT GLOBAL (Hauteur, Marges, Axes) ---
        const config = { responsive: true, displayModeBar: false };
        const colorMain = data.type === "Département" ? "#2c3e50" : "#3498db";

        // 1. DÉFINITION DES VARIABLES CONDITIONNELLES
        let marginBottom = 30; 
        let legendLayout = {
            orientation: 'v', 
            x: 1.02, 
            y: 1 
        }; 

        if (window.innerWidth <= 767) {
            marginBottom = 60; 
            legendLayout = {
                orientation: 'h', 
                x: 0,   
                y: -0.3 
            };
        }

var isMobile = (window.innerWidth <= 767);

var plotlyLayout = {
    margin: { 
        t: 40, 
        r: isMobile ? 5 : 10, 
        b: isMobile ? 80 : 40, 
        l: isMobile ? 35 : 60 
    },
    showlegend: true,
    legend: isMobile ? {
        orientation: 'h',
        x: 0.5,
        xanchor: 'center',
        y: -0.25 
    } : {
        orientation: 'v',
        x: 1.02,
        y: 1
    },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Segoe UI', size: 10 },
    xaxis: { gridcolor: '#eee', title: 'Année', range: [2014.5, 2030.5], zeroline: false },
    yaxis: { gridcolor: '#eee', rangemode: 'tozero' }
};

        // --- CHART 1: Émissions de gaz à effet de serre (GES) ---
        
        const seriesGES = [
            { key: 'GES_Agriculture', name: 'Agriculture', color: '#8BC34A' }, 
            { key: 'GES_Résidentiel', name: 'Résidentiel', color: '#FF9800' },
            { key: 'GES_Tertiaire', name: 'Tertiaire', color: '#FFEB3B' },
            { key: 'GES_Transports', name: 'Transports', color: '#2196F3' },
            { key: 'GES_Industrie', name: 'Industrie', color: '#FF5E4D' },
        ];
        
        const tracesGES = [];
        const gesYears = data.years; 
		        
        // 1. Calcul des totaux initiaux
        let totalEmissions = new Array(gesYears.length).fill(0);
        
        seriesGES.forEach(s => {
            if (data[s.key]) { 
                data[s.key].forEach((val, i) => {
                    if (val !== null) {
                        totalEmissions[i] += val;
                    }
                });
                
                // Ajout de la trace de barre
                tracesGES.push({
                    x: gesYears, 
                    y: data[s.key], 
                    type: 'bar', 
                    name: s.name,
                    marker: {color: s.color},
                    hovertemplate: 'Année %{x}<br>' + s.name + ': %{y:,.3f} MteqCO2<extra></extra>',
                });
            }
        });
        
        // 2. Création de la trace de texte pour les totaux
        const initialTextTrace = {
            x: gesYears, 
            y: totalEmissions.map(t => t > 0 ? t * 1.05 : null), 
            text: totalEmissions.map(t => t > 0 ? `<b>${t.toFixed(3)}</b>` : null), 
			mode: 'text',
            textposition: 'top center',
            textfont: { size: 12, color: '#333' },
            showlegend: false,
            hoverinfo: 'none',
            name: 'Total_Emissions' 
        };

       if (window.innerWidth > 767) {
            const initialTextTrace = {
                x: gesYears, 
                y: totalEmissions.map(t => t > 0 ? t * 1.05 : null), 
                text: totalEmissions.map(t => t > 0 ? `<b>${t.toFixed(3)}</b>` : null), 
                mode: 'text',
                textposition: 'top center',
                textfont: { size: 12, color: '#333' },
                showlegend: false,
                hoverinfo: 'none',
                name: 'Total_Emissions' 
            };
            // On ajoute la trace UNIQUEMENT si l'écran est grand
            tracesGES.push(initialTextTrace);
        }

        // Création d'un tableau d'années pour les ticks
        const allYearsTicks = Array.from({length: 2030 - 2015 + 1}, (_, i) => 2015 + i);
        const chart1Div = document.getElementById('chart1');

        // A. Tracé initial du graphique
        Plotly.newPlot(chart1Div, tracesGES, {
            ...plotlyLayout, 
            title: '(en MteqCO2)',
			barmode: 'stack',
			xaxis: {
                ...plotlyLayout.xaxis,
                tickvals: allYearsTicks, 
                tickmode: 'array' 
            }
        }, config);
        
        // B. Écouteur d'événement pour le recalcul des totaux après clic sur la légende
        chart1Div.on('plotly_restyle', function(data) {
            
            if (data[0].visible !== undefined) { 
                
                let totalEmissions = new Array(gesYears.length).fill(0);
                const currentTraces = chart1Div.data;
                const textTraceIndex = currentTraces.findIndex(t => t.name === 'Total_Emissions');

                // Boucle sur toutes les traces de barres visibles
                currentTraces.forEach((trace) => {
                    if (trace.type === 'bar' && trace.visible !== 'legendonly') {
                        trace.y.forEach((val, i) => {
                            if (val !== null) {
                                totalEmissions[i] += val;
                            }
                        });
                    }
                });

                // Préparation des nouvelles données pour la trace de texte
                const newText = totalEmissions.map(t => t > 0 ? `<b>${t.toFixed(3)}</b>` : null);
                const newY = totalEmissions.map(t => t > 0 ? t * 1.05 : null);

                if (textTraceIndex > -1) {
                    const update = {
                        y: [newY],
                        text: [newText]
                    };
                    Plotly.restyle(chart1Div, update, textTraceIndex);
                }
            }
        });
        
		// --- CHART 2 
Plotly.newPlot('chart2', [{ 
    x: data.years, 
    y: data.CONSO_Residentiel, 
    type: 'scatter', 
    mode: 'lines+markers',
	hovertemplate: 'Année %{x}<br>%{y:,.4f} TWh<extra></extra>',
    name: 'Consommation'
}], {
    ...plotlyLayout, 
    title: 'Consommation en TWh',
    height: 350, 
    showlegend: false 
}, config);

		// --- CHART 3
Plotly.newPlot('chart3', [{ 
    x: data.years, 
    y: data.CONSO_Tertiaire,
    type: 'scatter', 
    mode: 'lines+markers',
    hovertemplate: 'Année %{x}<br>%{y:,.4f} TWh<extra></extra>',
    name: 'Consommation'
}], {
    ...plotlyLayout,
    title: 'Consommation en TWh',
    height: 350, 
    showlegend: false 
}, config);
		
		
		
// --- CHART 4: Puissance ENR installée ---
        
        // Définition des séries et des couleurs pour l'ENR
        const seriesENR = [
            { key: 'puissance_enr_photo', name: 'Solaire Photovoltaïque', color: '#E91E63' }, 
            { key: 'puissance_enr_eolien', name: 'Éolien', color: '#4CAF50' }, 
            { key: 'puissance_enr_hydro', name: 'Hydraulique', color: '#2196F3' }, 
        ];
        
        // 1. Création des traces et calcul du total initial
        const tracesENR = [];
        let totalENREmissions = new Array(gesYears.length).fill(0);

        seriesENR.forEach(s => {
            if (data[s.key]) {
                data[s.key].forEach((val, i) => {
                    totalENREmissions[i] += parseFloat(val); 
                });
            }

            tracesENR.push({
                x: gesYears,  
                y: data[s.key], 
                type: 'bar', 
                name: s.name, 
                marker: {color: s.color},
                hovertemplate: 'Année %{x}<br>' + s.name + ': %{y:} GW<extra></extra>',
            });
        });

        // 2. Création de la trace de texte pour les totaux (avec condition mobile)
        let totalENRTraceIndex = -1; 
        if (window.innerWidth > 767) {
            const initialENRTextTrace = {
                x: gesYears, 
                y: totalENREmissions.map(t => t > 0 ? t * 1.05 : null), 
                text: totalENREmissions.map(t => t > 0 ? `<b>${t.toFixed(3)}</b>` : null), 
                mode: 'text',
                textposition: 'top center',
                textfont: { size: 12, color: '#333' },
                showlegend: false,
                hoverinfo: 'none',
                name: 'Total_ENR' 
            };
            tracesENR.push(initialENRTextTrace);
            // Si la trace est ajoutée, son index est le dernier du tableau
            totalENRTraceIndex = tracesENR.length - 1; 
        }
        
        const chart4Div = document.getElementById('chart4'); 

        // A. Tracé initial du graphique
Plotly.newPlot(chart4Div, tracesENR, {
    ...plotlyLayout, 
    title: 'Puissance en GW', 
    barmode: 'stack',
    height: 500,
    xaxis: {
        ...plotlyLayout.xaxis,
        tickvals: allYearsTicks, 
        tickmode: 'array' 
    },
    yaxis: {
        ...plotlyLayout.yaxis,
        title: '', 
        tickformat: '.3f' 
    }
}, config);

        // B. Écouteur d'événement pour le recalcul des totaux après clic sur la légende
       if (totalENRTraceIndex > -1) {
            chart4Div.on('plotly_restyle', function(data) {
                // On utilise l'index pré-calculé 'totalENRTraceIndex'
                if (data[0].visible !== undefined) { 
                    const chartData = chart4Div.data;
                    let currentTotal = new Array(gesYears.length).fill(0);
                    
                    // Boucle sur TOUTES les traces du graphique
                    for (let i = 0; i < chartData.length; i++) {
                        const trace = chartData[i];
                        
                        // Si la trace n'est PAS le total ET qu'elle est visible
                        if (i !== totalENRTraceIndex && (trace.visible === true || trace.visible === undefined)) {
                            // On vérifie qu'il s'agit bien d'une trace de données
                            if (trace.y) {
                                trace.y.forEach((val, index) => {
                                     currentTotal[index] += parseFloat(val);
                                });
                            }
                        }
                    }
                    
                    // Préparation des nouvelles données pour la trace de texte
                    const newText = currentTotal.map(t => t > 0 ? `<b>${t.toFixed(3)}</b>` : null);
                    const newY = currentTotal.map(t => t > 0 ? t * 1.05 : null);

                    // Mise à jour de la trace de total
                    Plotly.restyle(chart4Div, { y: [newY], text: [newText] }, [totalENRTraceIndex]);
                }
            });
        }
		
		// --- CHART 5: Production ENR Thermique ---
        
            const seriesThermique = [
            { key: 'prod_enr_thermique_bois_energie', name: 'Bois Énergie', color: '#4CAF50' },     
            { key: 'prod_enr_thermique_PAC', name: 'PAC (Pompes à Chaleur)', color: '#2196F3' }, 
            { key: 'prod_enr_thermique_Incinerateurs', name: 'Incinérateurs', color: '#F44336' },   
            { key: 'prod_enr_thermique_Biogaz', name: 'Biogaz', color: '#9C27B0' },     
            { key: 'prod_enr_thermique_Solaire_thermique', name: 'Solaire Thermique', color: '#FF9800' }, 
        ];
        
        // 1. Création des traces et calcul du total initial
        const tracesThermique = [];
        let totalThermique = new Array(gesYears.length).fill(0);

        seriesThermique.forEach(s => {
            if (data[s.key]) {
                data[s.key].forEach((val, i) => {
                    totalThermique[i] += parseFloat(val); 
                });
            }

            tracesThermique.push({
                x: gesYears,  
                y: data[s.key], 
                type: 'bar', 
                name: s.name, 
                marker: {color: s.color},
                // Afficher la donnée complète pour éviter l'arrondi
                hovertemplate: 'Année %{x}<br>' + s.name + ': %{y} TWh<extra></extra>', 
            });
        });

        // 2. Création de la trace de texte pour les totaux (avec condition mobile)
        let totalThermiqueTraceIndex = -1; 
        if (window.innerWidth > 767) {
            const initialThermiqueTextTrace = {
                x: gesYears, 
                y: totalThermique.map(t => t > 0 ? t * 1.05 : null), 
                // Formatage à 3 décimales pour la cohérence
                text: totalThermique.map(t => t > 0 ? `<b>${t.toFixed(3)}</b>` : null), 
                mode: 'text',
                textposition: 'top center',
                textfont: { size: 12, color: '#333' },
                showlegend: false,
                hoverinfo: 'none',
                name: 'Total_Thermique' 
            };
            tracesThermique.push(initialThermiqueTextTrace);
            totalThermiqueTraceIndex = tracesThermique.length - 1; 
        }
        
        const chart5Div = document.getElementById('chart5'); 

        // A. Tracé initial du graphique
        Plotly.newPlot(chart5Div, tracesThermique, {
            ...plotlyLayout, 
            title: 'Production en TWh', 
            barmode: 'stack',
            height: 500, 
            xaxis: {
                ...plotlyLayout.xaxis,
                tickvals: allYearsTicks, 
                tickmode: 'array' 
            },
            yaxis: {
                ...plotlyLayout.yaxis,
                title: '',
                tickformat: '.3f'
            }
        }, config);
		
		// B. Écouteur d'événement pour le recalcul des totaux après clic sur la légende
        if (totalThermiqueTraceIndex > -1) {
            chart5Div.on('plotly_restyle', function(data) {
                
                if (data[0].visible !== undefined) { 
                    const chartData = chart5Div.data;
                    let currentTotal = new Array(gesYears.length).fill(0);
                    
                    for (let i = 0; i < chartData.length; i++) {
                        const trace = chartData[i];
                        
                        // Si la trace n'est PAS le total ET qu'elle est visible
                        if (i !== totalThermiqueTraceIndex && (trace.visible === true || trace.visible === undefined)) {
                            if (trace.y) {
                                trace.y.forEach((val, index) => {
                                     currentTotal[index] += parseFloat(val);
                                });
                            }
                        }
                    }
                    
                    // Préparation des nouvelles données pour la trace de texte
                    const newText = currentTotal.map(t => t > 0 ? `<b>${t.toFixed(3)}</b>` : null);
                    const newY = currentTotal.map(t => t > 0 ? t * 1.05 : null);

                    // Mise à jour de la trace de total
                    Plotly.restyle(chart5Div, { y: [newY], text: [newText] }, [totalThermiqueTraceIndex]);
                }
            });
        }
        
// --- CHART 6: Chaleur renouvelable livrée
if (data.chaleur_renouvelable && data.chaleur_renouvelable.some(v => v > 0)) {
    Plotly.newPlot('chart6', [{ 
        x: data.years, 
        y: data.chaleur_renouvelable,
        type: 'scatter', 
        mode: 'lines+markers',
        name: 'Chaleur renouvelable livrée',
        line: {
            color: '#FF6347',
            width: 3
        },
        marker: {
            color: '#FF6347',
            size: 8
        },
        hovertemplate: 'Année %{x}<br> %{y:,.6f} TWh<extra></extra>'
    }], {
        ...plotlyLayout,
        yaxis: { ...plotlyLayout.yaxis, title: 'En TWh' },
        xaxis: { ...plotlyLayout.xaxis, range: [2014.5, 2030.5] }, 
        height: 350, 
        showlegend: false 
    }, config); 
} else {
    Plotly.newPlot('chart6', [], {
        ...plotlyLayout,
        height: 350,
        xaxis: { 
            ...plotlyLayout.xaxis, 
            visible: true, 
            range: [2014.5, 2030.5] 
        }, 
        yaxis: { 
            ...plotlyLayout.yaxis, 
            visible: true, 
            title: 'En TWh' 
        },
        annotations: [{
            text: "<b>Pas de donnée à cette échelle</b>",
            xref: "paper",
            yref: "paper",
            x: 0.5,
            y: 0.5,
            showarrow: false,
            font: { size: 16, color: '#7f8c8d' }
        }]
    }, config);
}

		        
// --- CHART 7 : Voitures électriques
Plotly.newPlot('chart7', [{ 
    x: data.years, 
    y: data.pourcentageVPelectrique,
    type: 'scatter', 
    mode: 'lines+markers',
    name: 'Voitures électriques',
    hovertemplate: 'Année %{x}<br>%{y:,.2f} %<extra></extra>',
    line: {
        color: '#4CAF50',
        width: 3
    },
    marker: {
        color: '#4CAF50',
        size: 8
    }
    // --------------------------------------
}], {
    ...plotlyLayout,
    title: 'En pourcentage',
    height: 350, 
    showlegend: false 
}, config);


// --- CHART 8 : Aménagements cyclables
Plotly.newPlot('chart8', [{ 
    x: data.years, 
    y: data.amenagements_cyclable,
    type: 'scatter', 
    mode: 'lines+markers',
    name: 'Aménagements cyclables',
    hovertemplate: 'Année %{x}<br>%{y:,.2f} kilomètres<extra></extra>',
    line: {
        color: '#4CAF50',
        width: 3
    },
    marker: {
        color: '#4CAF50',
        size: 8
    }
    // --------------------------------------
}], {
    ...plotlyLayout,
    title: 'En kilomètres',
    height: 350, 
    showlegend: false 
}, config);

     
// --- CHART9 : Quantité de déchets enfouis annuellement
Plotly.newPlot('chart9', [{ 
    x: data.years, 
    y: data.tonnage_dechets_enfouis,
    type: 'scatter', 
    mode: 'lines+markers',
    name: 'Déchets enfouis annuellement',
    line: {
        color: '#FF6347',
        width: 3
    },
    marker: {
        color: '#FF6347',
        size: 8
    },
    hovertemplate: 'Année %{x}<br>Tonnage: %{y:.,1f} tonnes<extra></extra>' 
}], {
    ...plotlyLayout,
    title: 'En tonnes',
    height: 350, 
    showlegend: false,
    yaxis: {
        rangemode: 'tozero',
        tickformat: ',.0f' 
    }
 
}, config);

		    
// --- CHART 10: Part des déchets recyclés ---
        
const chart10Div = document.getElementById('chart10');
const partDechetsRecycles = data.part_dechets_recycles;

// 1. Trace pour les barres
const traceBarresDechets = {
    x: gesYears,
    y: partDechetsRecycles,
    type: 'bar',
    name: 'Part recyclée',
    marker: {
        color: '#4CAF50'
    },
    hovertemplate: 'Année %{x}<br>Part recyclée: %{y:.1f} %<extra></extra>',
    showlegend: false
};

// 2. Trace pour les étiquettes de texte au-dessus des barres
const traceTextDechets = {
    x: gesYears,
    y: partDechetsRecycles.map(val => val !== null ? val + 3 : null),
    text: partDechetsRecycles.map(val => val !== null ? `${val.toFixed(0)}%` : null),
    mode: 'text',
    textposition: 'top center',
    textfont: { size: 12, color: '#4CAF50' },
    showlegend: false,
    hoverinfo: 'none',
    name: 'Etiquettes'
};

// 3. Tracé du graphique
Plotly.newPlot(chart10Div, [traceBarresDechets, traceTextDechets], {
    ...plotlyLayout,
    title: 'En pourcentage',
    height: 350,
    showlegend: false,
    margin: {
        ...plotlyLayout.margin,
        t: 60
    },

    xaxis: {
        ...plotlyLayout.xaxis,
        tickvals: allYearsTicks,
        tickmode: 'array'
    },
    yaxis: {
        ...plotlyLayout.yaxis,
        title: '',
        tickformat: '.0f',
        range: [0, 110],
        autorange: false
    }
}, config);

        
// --- CHART 11: Nombre d’espaces de réemploi
const chart11Div = document.getElementById('chart11');
const nbreRecycleries = data.nbre_recycleries;

if (nbreRecycleries && nbreRecycleries.some(v => v > 0)) {
    
    // 1. Détermination de la valeur maximale pour l'axe Y
    const actualMax = Math.max(...nbreRecycleries.filter(val => val !== null));
    const maxRecycleries = (actualMax > 0) ? actualMax : 2; 

    // 2. Trace pour les barres
    const traceBarresRecycleries = {
        x: data.years, 
        y: nbreRecycleries,
        type: 'bar',
        name: 'En nombre',
        marker: { color: '#4CAF50' },
        hovertemplate: 'Année %{x}<br>Nombre: %{y:.0f}<extra></extra>',
        showlegend: false
    };
    
    // 3. Trace pour les étiquettes de texte
    const traceTextRecycleries = {
        x: data.years, 
        y: nbreRecycleries.map(val => val !== null ? val + (maxRecycleries * 0.1) : null), 
        text: nbreRecycleries.map(val => val !== null ? `${val.toFixed(0)}` : null), 
        mode: 'text',
        textposition: 'top center',
        textfont: { size: 12, color: '#4CAF50' },
        showlegend: false,
        hoverinfo: 'none', 
        name: 'Etiquettes'
    };
    
    // 4. Tracé du graphique avec données
    Plotly.newPlot(chart11Div, [traceBarresRecycleries, traceTextRecycleries], {
        ...plotlyLayout, 
        title: 'En nombre', 
        height: 350,
        showlegend: false,
        margin: {
            t: 60, 
            r: 10,
            b: plotlyLayout.margin.b, 
            l: plotlyLayout.margin.l
        },
        xaxis: {
            ...plotlyLayout.xaxis,
            range: [2014.5, 2030.5],
            tickvals: allYearsTicks, 
            tickmode: 'array' 
        },
        yaxis: {
            ...plotlyLayout.yaxis,
            title: 'Nombre', 
            tickformat: '.0f',
            dtick: 1, 
            range: [0, maxRecycleries * 1.2], 
            autorange: false 
        }
    }, config);

} else {
    Plotly.newPlot(chart11Div, [], {
        ...plotlyLayout,
        height: 350,
        title: 'En nombre',
        xaxis: { 
            ...plotlyLayout.xaxis, 
            visible: true, 
            range: [2014.5, 2030.5],
            tickvals: allYearsTicks,
            tickmode: 'array'
        }, 
        yaxis: { 
            ...plotlyLayout.yaxis, 
            visible: true, 
            title: 'Nombre',
            range: [0, 2]
        },
        annotations: [{
            text: "<b>Pas de donnée à cette échelle</b>",
            xref: "paper",
            yref: "paper",
            x: 0.5,
            y: 0.5,
            showarrow: false,
            font: { size: 16, color: '#7f8c8d' }
        }]
    }, config);
}

// --- CHART 12: Volumes d’eau prélevée
        
        const seriesWater = [
            { key: 'eau_potable', name: 'Alimentation en eau potable', color: '#3498db' }, 
            { key: 'industrie', name: 'Industrie et activités économiques', color: '#e74c3c' }, 
            { key: 'irrigation', name: 'Irrigation agricole', color: '#2ecc71' }, 
            { key: 'canaux', name: 'Canaux de navigation', color: '#34495e' }, 
        ];
        
        // 1. Création des traces et calcul du total initial
        const tracesWater = [];
        // gesYears est utilisé car les deux graphiques partagent le même axe temporel
        let totalWater = new Array(gesYears.length).fill(0); 

        seriesWater.forEach(s => {
            if (data[s.key]) {
                data[s.key].forEach((val, i) => {
                    // Calcul du total initial pour les barres empilées
                    totalWater[i] += parseFloat(val); 
                });
            }

            tracesWater.push({
                x: gesYears,  
                y: data[s.key], 
                type: 'bar', 
                name: s.name, 
                marker: {color: s.color},
                hovertemplate: 'Année %{x}<br>' + s.name + ': %{y} millions de m³<extra></extra>', 
            });
        });

        // 2. Création de la trace de texte pour les totaux (avec condition mobile)
        let totalWaterTraceIndex = -1; 
        const chart12Div = document.getElementById('chart12'); 

        // Si ce n'est pas un petit écran
        if (window.innerWidth > 767) {
            const initialWaterTextTrace = {
                x: gesYears, 
                y: totalWater.map(t => t > 0 ? t * 1.05 : null), 
                text: totalWater.map(t => t > 0 ? `<b>${t.toFixed(2)}</b>` : null), 
                mode: 'text',
                textposition: 'top center',
                textfont: { size: 12, color: '#333' },
                showlegend: false,
                hoverinfo: 'none',
                name: 'Total_Water' 
            };
            tracesWater.push(initialWaterTextTrace);
            totalWaterTraceIndex = tracesWater.length - 1; 
        }
        
        // A. Tracé initial du graphique
        Plotly.newPlot(chart12Div, tracesWater, {
            ...plotlyLayout, 
            title: 'En millions de m³', 
            barmode: 'stack',
            height: 500,
            xaxis: {
                ...plotlyLayout.xaxis,
                tickvals: allYearsTicks, 
                tickmode: 'array' 
            },
            yaxis: {
                ...plotlyLayout.yaxis,
                title: 'Volume (millions de m³)',
                tickformat: '.2f'
            }
        }, config);
        
        // B. Écouteur d'événement pour le recalcul des totaux après clic sur la légende
        if (totalWaterTraceIndex > -1) {
            chart12Div.on('plotly_restyle', function(data) {
                
                if (data[0].visible !== undefined) { 
                    const chartData = chart12Div.data;
                    let currentTotal = new Array(gesYears.length).fill(0);
                    
                    for (let i = 0; i < chartData.length; i++) {
                        const trace = chartData[i];
                        
                        // Si la trace n'est PAS le total ET qu'elle est visible
                        if (i !== totalWaterTraceIndex && (trace.visible === true || trace.visible === undefined)) {
                            if (trace.y) {
                                trace.y.forEach((val, index) => {
                                     // S'assurer que la valeur est un nombre
                                     if (val !== null && typeof val === 'number') {
                                        currentTotal[index] += val;
                                     }
                                });
                            }
                        }
                    }
                    
                    // Préparation des nouvelles données pour la trace de texte
                    const newText = currentTotal.map(t => t > 0 ? `<b>${t.toFixed(2)}</b>` : null); // 2 décimales
                    const newY = currentTotal.map(t => t > 0 ? t * 1.05 : null);

                    // Mise à jour de la trace de total
                    Plotly.restyle(chart12Div, { y: [newY], text: [newText] }, [totalWaterTraceIndex]);
                }
            });
        }
		
		
		// --- CHART 13 : Conso Enaf
Plotly.newPlot('chart13', [{ 
    x: data.years, 
    y: data.Conso_ENAF,
    type: 'bar', // On change scatter par bar
    name: 'Consommation ENAF',
    hovertemplate: 'Année %{x}<br>%{y:,.2f} hectares<extra></extra>',
    marker: {
        color: '#4CAF50' // La couleur s'applique maintenant au remplissage des barres
    }
}], {
    ...plotlyLayout,
    title: 'En hectares',
    height: 500, 
    showlegend: false,
    xaxis: {
        ...plotlyLayout.xaxis,
        tickmode: 'linear',
        dtick: 1 // Pour s'assurer d'avoir une barre par année bien identifiée
    }
}, config);

// --- CHART 14: Résorption des principaux obstacles à la libre circulation des espèces ---
const chart14Div = document.getElementById('chart14');

const osmoKeys = ['Osmo_aban', 'Osmo_ter', 'Osmo_enga', 'Osmo_ini', 'Osmo_previ'];

const hasOsmoData = osmoKeys.some(key => data[key] && data[key].some(v => v > 0));

if (hasOsmoData) {
    const osmoSeries = [
        { key: 'Osmo_aban', name: 'Abandonnée', color: '#808080' },
        { key: 'Osmo_ter', name: 'Terminée', color: '#7CFC00' },
        { key: 'Osmo_enga', name: 'Engagée', color: '#FFFF00' },
        { key: 'Osmo_ini', name: 'Initiée', color: '#FFA500' },
        { key: 'Osmo_previ', name: 'Action prévisionnelle', color: '#FF0000' }
    ];
    let tracesOsmo = [];
    let yearTotals = new Array(data.years.length).fill(0);
    let progressTotals = new Array(data.years.length).fill(0);

    osmoSeries.forEach(s => {
        if (data[s.key]) {
            tracesOsmo.push({
                x: data.years,
                y: data[s.key],
                name: s.name,
                type: 'bar',
                marker: { color: s.color },
                hoverinfo: 'text',
                textposition: 'none', 
                text: data[s.key].map((val, i) => 
                    `Année : ${data.years[i]} <br>${s.name} : ${val} ouvrages`
                )
            });

            data[s.key].forEach((val, i) => {
                const v = val || 0;
                yearTotals[i] += v;
                if (['Osmo_aban', 'Osmo_ter', 'Osmo_enga'].includes(s.key)) {
                    progressTotals[i] += v;
                }
            });
        }
    });

    const tickTexts = data.years.map((year, i) => {
        const total = yearTotals[i];
        return total > 0 ? `${year}<br><b>${Math.round((progressTotals[i] / total) * 100)}%</b>` : `${year}`;
    });

    Plotly.newPlot(chart14Div, tracesOsmo, {
        ...plotlyLayout,
        title: "Nombre d’ouvrages prioritaires classés par niveau<br> d’avancement des actions de restauration",
        barmode: 'stack',
        height: 500,
        margin: { t: 60, b: 100, l: 60, r: 10 },
        hovermode: 'closest',
        xaxis: { 
            ...plotlyLayout.xaxis, 
            visible: true, 
            range: [2023.5, 2030.5], 
            tickvals: data.years, 
            ticktext: tickTexts,
            title: "Année et % des ouvrages traités ou en voie de l'être"
        },
        yaxis: { 
            ...plotlyLayout.yaxis, 
            visible: true, 
            title: "Nombre d'ouvrages" 
        },
        legend: { orientation: 'h', y: -0.3 }
    }, config);

} else {
     Plotly.newPlot(chart14Div, [], {
        ...plotlyLayout,
        height: 460,
        margin: { t: 60, b: 100, l: 60, r: 10 },
        xaxis: { 
            ...plotlyLayout.xaxis, 
            visible: true, 
            range: [2023.5, 2030.5],
            title: "Année et % des ouvrages traités ou en voie de l'être"
        }, 
        yaxis: { 
            ...plotlyLayout.yaxis, 
            visible: true, 
            title: "Nombre d'ouvrages",
            range: [0, 80],
            dtick: 20
        },
        annotations: [{
            text: "<b>Pas de donnée à cette échelle</b>",
            xref: "paper", yref: "paper", x: 0.5, y: 0.5,
            showarrow: false,
            font: { size: 16, color: '#7f8c8d' }
        }]
    }, config);
}

// --- CHART 15 : Aires protégées

const hasData15 = data.aires_protegees && data.aires_protegees.some(v => v !== null && v !== "" && Number(v) > 0);

const yAxisFixed = {
    ...plotlyLayout.yaxis,
    title: 'En %',
    visible: true,
    range: [0, 12],
    autorange: false
};

if (hasData15) {
    Plotly.newPlot('chart15', [{ 
        x: data.years, 
        y: data.aires_protegees,
        type: 'scatter', 
        mode: 'lines+markers',
        name: 'Aires protégées',
        hovertemplate: 'Année %{x}<br>%{y:,.2f} %<extra></extra>',
        line: { color: '#4CAF50', width: 3 },
        marker: { color: '#4CAF50', size: 8 }
    }], {
        ...plotlyLayout,
        title: "En pourcentage",
        height: 380, 
        showlegend: false,
        yaxis: yAxisFixed,
        xaxis: { 
            ...plotlyLayout.xaxis, 
            range: [2019.5, 2030.5],
            tickmode: 'linear',
            tick0: 2020,
            dtick: 1 
        },
        // Ajustement de la marge haute pour laisser de la place au titre standard
        margin: { ...plotlyLayout.margin, t: 40 } 
    }, config); 
} else {
    // Bloc sans données (généralement sans titre pour rester cohérent avec tes autres graphs vides)
    Plotly.newPlot('chart15', [], {
        ...plotlyLayout,
        height: 380,
        xaxis: { 
            ...plotlyLayout.xaxis, 
            visible: true, 
            range: [2019.5, 2030.5],
            tickmode: 'linear',
            tick0: 2020,
            dtick: 1
        }, 
        yaxis: yAxisFixed,
        annotations: [{
            text: "<b>Pas de donnée à cette échelle</b>",
            xref: "paper",
            yref: "paper",
            x: 0.5,
            y: 0.5,
            showarrow: false,
            font: { size: 16, color: '#7f8c8d' }
        }]
    }, config);
}



        // ... (Le code pour les autres graphiques) ...
        
     
    }
	

    function initDashboard() {
        if (departments.length > 0) {
            loadingMessage.innerText = "Données prêtes. Sélectionnez un territoire.";
            
            // Activer les sélecteurs
            deptSelect.disabled = false;
            epciSelect.disabled = false;
            
            // Remplissage initial
            deptSelect.innerHTML = "";
            departments.forEach(d => {
                deptSelect.add(new Option(d.name, d.code));
            });

            // Lancement initial sur le premier département
            const firstDept = departments[0].code;
            updateEpciList(firstDept);
            updateDashboard('ALL_DEPT');

            // Événements
            deptSelect.addEventListener('change', () => {
                const newDeptCode = deptSelect.value;
                updateEpciList(newDeptCode);
                updateDashboard('ALL_DEPT');
            });

            epciSelect.addEventListener('change', (e) => {
                updateDashboard(e.target.value);
            });
            
        } else {
            loadingMessage.innerText = "Aucune donnée départementale valide trouvée dans le CSV.";
        }
    }

    // DÉMARRAGE : Appel de la fonction de chargement
    loadCSV();

let resizeTimer;
window.onresize = function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
        const graphDivs = document.getElementsByClassName('plotly-graph-div');
        for (let i = 0; i < graphDivs.length; i++) { 
            Plotly.Plots.resize(graphDivs[i]); 
        }
    }, 200);
};

  const toggle = document.querySelector('.mobile-menu-toggle');
  const menu = document.querySelector('.sub-nav');

  toggle.addEventListener('click', () => {
    menu.classList.toggle('active');
  });