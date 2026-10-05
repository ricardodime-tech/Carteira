const express = require('express');
const { MongoClient } = require('mongodb');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

const path = require('path');
const fs = require('fs');

const app = express();

const uri = "mongodb+srv://ricardodime_db_user:VRm9WGOwTzKb1fiq@cluster0.wxgj33t.mongodb.net/";
const dbName = "Carteira_db";
const collectionName = "Acoes_clc";

app.use(express.static(path.join(process.cwd(), 'public')));
app.use(express.json());

// Rota principal (Exibe a tabela na página web)
app.get('/', async (req, res) => {
    let client;
    try {
        client = new MongoClient(uri);
        await client.connect();
        
        const db = client.db(dbName);
        const acoes = await db.collection(collectionName).find({}).toArray();

        let linhasTabela = acoes.map(acao => {
            const variacaoClass = acao.Variacao >= 0 ? 'positivo' : 'negativo';
            
            return `
                <tr>
                    <td><strong>${acao.Ticker}</strong></td>
                    <td class="editavel">R$ ${Number(acao.Preco).toFixed(2)}</td>
                    <td class="editavel ${variacaoClass}">${acao.Variacao}%</td>
                    <td class="editavel">${acao.Quantidade}</td>
                    <td>R$ ${acao.VT}</td>
                    <td>${acao.UA}</td>
                    <td>
                        <button class="btn-editar" onclick="habilitarEdicao(this, '${acao.Ticker}')">Editar</button>
                    </td>
                </tr>
            `;
        }).join('');

        if (acoes.length === 0) {
            linhasTabela = '<tr><td colspan="7" style="text-align:center;">Nenhuma ação encontrada.</td></tr>';
        }

        const caminhoHtml = path.join(process.cwd(), 'views', 'index.html');
        let arquivoHtml = fs.readFileSync(caminhoHtml, 'utf8');
        arquivoHtml = arquivoHtml.replace('{{tabelaAcoes}}', linhasTabela);

        res.send(arquivoHtml);

    } catch (error) {
        console.error("Erro ao conectar ao MongoDB:", error);
        res.status(500).send("Erro ao carregar os dados do banco de dados.");
    } finally {
        if (client) {
            await client.close();
        }
    }
});

// Rota para fornecer dados ao Gráfico
app.get('/dados-grafico', async (req, res) => {
    let client;
    try {
        client = new MongoClient(uri);
        await client.connect();
        const db = client.db(dbName);
        const acoes = await db.collection(collectionName).find({}).toArray();

        res.status(200).json(acoes);
    } catch (error) {
        console.error("Erro ao buscar dados para o gráfico:", error);
        res.status(500).json({ mensagem: "Erro ao carregar gráfico." });
    } finally {
        if (client) { await client.close(); }
    }
});

// Rota para Adicionar um Novo Ativo
app.post('/adicionar', async (req, res) => {
    const { Ticker, Preco, Variacao, Quantidade, VT, UA } = req.body;

    if (!Ticker) {
        return res.status(400).json({ mensagem: "O Ticker é obrigatório." });
    }

    let client;
    try {
        client = new MongoClient(uri);
        await client.connect();
        const db = client.db(dbName);

        const existente = await db.collection(collectionName).findOne({ Ticker: Ticker });
        if (existente) {
            return res.status(400).json({ mensagem: "Este ativo já está cadastrado na carteira." });
        }

        await db.collection(collectionName).insertOne({
            Ticker: Ticker,
            Preco: Number(Preco),
            Variacao: Number(Variacao || 0),
            Quantidade: Number(Quantidade),
            VT: String(VT),
            UA: UA
        });

        res.status(200).json({ mensagem: "Ativo adicionado com sucesso!" });
    } catch (error) {
        console.error("Erro ao adicionar ativo:", error);
        res.status(500).json({ mensagem: "Erro interno ao adicionar ativo." });
    } finally {
        if (client) { await client.close(); }
    }
});

// Rota para Salvar Edição Manual
app.post('/atualizar/:ticker', async (req, res) => {
    const ticker = req.params.ticker;
    const { Preco, Variacao, Quantidade, VT, UA } = req.body;

    let client;
    try {
        client = new MongoClient(uri);
        await client.connect();
        const db = client.db(dbName);
        
        await db.collection(collectionName).updateOne(
            { Ticker: ticker },
            { 
                $set: { 
                    Preco: Number(Preco), 
                    Variacao: Number(Variacao), 
                    Quantidade: Number(Quantidade), 
                    VT: VT, 
                    UA: UA 
                } 
            }
        );

        res.status(200).json({ mensagem: "Atualizado com sucesso!" });
    } catch (error) {
        console.error("Erro ao atualizar o MongoDB:", error);
        res.status(500).json({ mensagem: "Erro ao atualizar." });
    } finally {
        if (client) { await client.close(); }
    }
});

// Rota Global: Atualiza TODOS os ativos pelo Yahoo Finance
app.post('/yahoo/atualizar-todos', async (req, res) => {
    let client;
    try {
        client = new MongoClient(uri);
        await client.connect();
        const db = client.db(dbName);
        
        const acoes = await db.collection(collectionName).find({}).toArray();
        const ultimaAtualizacao = new Date().toLocaleTimeString('pt-BR');

        for (let acao of acoes) {
            let tickerOriginal = acao.Ticker.toUpperCase();
            const queryTicker = tickerOriginal.endsWith('.SA') ? tickerOriginal : `${tickerOriginal}.SA`;

            try {
                console.log(`Buscando no Yahoo Finance: ${queryTicker}`);
                const resultadoYahoo = await yahooFinance.quote(queryTicker);

                if (resultadoYahoo && (resultadoYahoo.regularMarketPrice !== undefined)) {
                    const precoAtual = resultadoYahoo.regularMarketPrice;
                    const variacaoPercentual = resultadoYahoo.regularMarketChangePercent || 0;
                    const valorTotal = (precoAtual * acao.Quantidade).toFixed(2);

                    await db.collection(collectionName).updateOne(
                        { Ticker: tickerOriginal },
                        { 
                            $set: { 
                                Preco: Number(precoAtual.toFixed(2)), 
                                Variacao: Number(variacaoPercentual.toFixed(2)), 
                                VT: String(valorTotal), 
                                UA: ultimaAtualizacao 
                            } 
                        }
                    );
                }
            } catch (err) {
                console.error(`Aviso: Não foi possível atualizar o ativo ${tickerOriginal}:`, err.message);
            }
        }

        res.status(200).json({ mensagem: "Cotações atualizadas com sucesso!" });
    } catch (error) {
        console.error("Erro geral ao atualizar cotações:", error);
        res.status(500).json({ mensagem: "Erro ao atualizar as cotações." });
    } finally {
        if (client) { await client.close(); }
    }
});      

// Executa localmente caso não esteja em produção (na Vercel)
if (process.env.NODE_ENV !== 'production') {
    const PORT = 3000;
    app.listen(PORT, () => {
        console.log(`Servidor rodando localmente! Acesse: http://localhost:${PORT}`);
    });
}

// Exportação necessária para a Vercel funcionar como Serverless
module.exports = app;