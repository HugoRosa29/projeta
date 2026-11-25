-- Titulares das unidades: o titular é o Gestor do espaço oficial da unidade (ADR 0007).
-- Fonte: planilha "Responsáveis pelas Unidades orgânicas da TERRACAP" (novembro/2026).
-- Só o nome entra; e-mail e telefone da planilha são das caixas das unidades e não servem aqui.
-- Trocou o titular: nova migração com UPDATE, nunca editar esta.

-- Unidades da planilha que faltavam no organograma de agosto/2026. COINC resolve a dúvida
-- COINC × CORUR do ADR 0004 (CORUR fica, sem titular, até alguém confirmar que deixou de existir).
-- CPLIC entra sob a GECOP pela posição na planilha; confirmar.
INSERT INTO org_units(sigla, label, parent) VALUES
  ('COINC', 'COINC', 'DICOM'),
  ('CPLIC', 'CPLIC', 'GECOP');

CREATE TABLE org_unit_heads (
  sigla text PRIMARY KEY REFERENCES org_units(sigla),
  name text NOT NULL
);

-- Chave de comparação de nomes: sem acento, sem pontuação, espaços simples, maiúsculas.
-- O GIA e a planilha escrevem o mesmo nome de jeitos diferentes (caixa, acento, espaço duro).
CREATE FUNCTION projeta_name_key(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(upper(translate(n,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^A-Z]+', ' ', 'g'))
$$;

INSERT INTO org_unit_heads(sigla, name) VALUES
  ('PRESIDENCIA', 'Júlio Cesar de Azevedo Reis'),
  ('GABIN', 'Israel Marcos da Costa Brandão'),
  ('ASSOC', 'Gesiel Pereira de Sousa'),
  ('CORED', 'Jackeline Viana da Costa'),
  ('COINT', 'Luiz Cláudio de Freitas'),
  ('DICOP', 'Carolina Barbosa Martinez'),
  ('DIGER', 'Tatiana Treuherz Salomão'),
  ('COTIN', 'Júlio Cézar Schettini Henriques'),
  ('DIGTI', 'Fábio Galvão Ferreira Tabosa'),
  ('DISEG', 'Thiago de Paula Moraes'),
  ('DISID', 'Romildo Ribeiro dos Santos'),
  ('DIRAU', 'Daniel Reis Santos'),
  ('CPLAM', 'Aliendres Souto Sousa'),
  ('DIPLA', 'Rafael Rodrigues Sales'),
  ('DIMOG', 'Karina Nunes Alves Costa'),
  ('OUVIDORIA', 'Cecilia Magalhães Camilo'),
  ('ASCOM', 'Tatielly Mourão Diniz'),
  ('COINS', 'Felipe Oliveira Licursi'),
  ('DIJUR', 'Fernando de Assis Bontempo'),
  ('COJUR', 'Oswaldo Pinheiro Ribeiro Junior'),
  ('CESUT', 'Leonel Faria de Santana Ramos'),
  ('SEACO', 'Roberto Borba de Castro'),
  ('NUDAP', 'Valéria Silva Freitas'),
  ('DIRAF', 'Kaline Gonzaga Costa'),
  ('ADRAF', 'Raphaela Santos Vieira'),
  ('GEARI', 'Luís Diego Gomes Carneiro'),
  ('NUGRE', 'Jesiel Afonso da Silva'),
  ('NUNEG', 'Samuel Raposo Mascarenha'),
  ('NUFID', 'Fábio Gomes Barbosa'),
  ('NUAFI', 'Tatyana Kovaleva Modesto'),
  ('GEFIN', 'Marcelo Eccard da Silva'),
  ('NUGEF', 'Sara Miriam Gomes'),
  ('NUCOR', 'Giovani Luiz Medeiros de Souza'),
  ('GECOT', 'Elias Araujo de Lucena Neto'),
  ('NUREC', 'Elias Araujo de Lucena Neto'),
  ('NUCOC', 'Eduardo Pereira Chamon'),
  ('GETRI', 'Hélio de Souza Oliveira'),
  ('NUTRI', 'Samuel Portela Freitas'),
  ('NURFI', 'Marcio Carlos Bezerra'),
  ('GERAT', 'Sandro de Melo Trindade'),
  ('NUTAN', 'Itamar Antônio Fernandes'),
  ('NUDOC', 'Marcelo Alves do Nascimento'),
  ('NUGER', 'Alexandre Gomes de Matos'),
  ('NUPAT', 'Maurício Ferreira'),
  ('NUMAT', 'Renato Jorge Guimarães'),
  ('GECOP', 'Leandro do Carmo Cruz'),
  ('CPLIC', 'Ladércio Brito Santos Filho'),
  ('NUCCA', 'Robson Alves Ferreira'),
  ('GEPES', 'Juracir Santos Júnior'),
  ('NUDIV', 'José Marcos Dias Pereira'),
  ('NUBEN', 'Fernando Luiz de Faria Xavier'),
  ('SESMT', 'Juracir Santos Júnior'),
  ('GEPAG', 'Jaqueline Ferreira dos Santos'),
  ('NUCAF', 'Pedro Ferreira da Cunha Neto'),
  ('NUPAG', 'Cecilia Alvares Correa'),
  ('NUCAT', 'Giulia Maria Cavalcanti Freire'),
  ('GECOE', 'Clayton Carneiro de França'),
  ('DICOM', 'Renato Correia Leal'),
  ('ADCOM', 'Noelma de Almeida Gomes'),
  ('COINC', 'Sidrack de Oliveira Correia Neto'),
  ('COPLI', 'Bruno César Santana de Meneses'),
  ('COVED', 'Kenya Cristina Alves'),
  ('GEVED', 'Felipe Santos Araujo'),
  ('GECOM', 'Karen Fernandes Ribeiro'),
  ('NUCOM', 'Wagner Conrado Quintaneiro'),
  ('NUGEC', 'Alípio Valadares Fernandes'),
  ('NUCAD', 'Maria Helena Chaves Pinheiro Godeiro Gasparinetti'),
  ('GEPEA', 'Michelle Gonçalves Pedrosa'),
  ('NUPEA', 'Manuela Falcão Marques'),
  ('GEATE', 'Maria do Amparo Gomes Vilela'),
  ('GETOP', 'Alessandro Carvalho dos Santos'),
  ('NUGET', 'Vitor Hugo Santos da Silva'),
  ('NUANF', 'Gabriela Takahashi Miyoshi'),
  ('GEREF', 'Giulliano Magalhães Penatti'),
  ('DITEC', 'Carlos Antonio Leal'),
  ('ADTEC', 'João Alberto Legey Siqueira'),
  ('GEPRO', 'Bianca Ilha Pereira'),
  ('NUARQ', 'Natália Oliveira de Freitas'),
  ('NUREG', 'Marta Regina Machado Serejo'),
  ('GEREN', 'Carlos Augusto Ribeiro Silva'),
  ('NUENC', 'Cássio Cardoso Tavelin'),
  ('NUPOE', 'Johathan de Castro Dallangnol'),
  ('NUENE', 'Iran Batista Vieira'),
  ('GEMAM', 'Albatênio Resende Granja Júnior'),
  ('NULIC', 'Leandro Ruas Tavares e Sousa'),
  ('NUAMB', 'Paulo Cesar Costa'),
  ('GEFIS', 'Alexandre do Nascimento Bittencourt'),
  ('NUVIS', 'Andre Luis de Freitas Xavier'),
  ('NUFIS', 'Flávio Aparecido Vieira Mendes'),
  ('DIRES', 'Carlos Fernando Pereira Ferreira'),
  ('ADRES', 'Wesley Silva de Menezes'),
  ('COREG', 'César Tadeu Fussigher Portella'),
  ('GEDES', 'Elizeu Eliel da Silva Oliveira'),
  ('NUPRO', 'Francisco Ronaldo Filgueira da Silva'),
  ('GEHAB', 'Mateus Barbosa Rodrigues'),
  ('NUDOP', 'Bruno Carneiro Pereira'),
  ('DINEG', 'Leonardo Henrique Mundim Moraes Oliveira'),
  ('ADNEG', 'Thiago de Jesus Soares Freire'),
  ('GEFOR', 'Mayta Versiani Cardoso'),
  ('GENEG', 'João Paulo dos Santos Vieira');

-- Titulares que já entraram pelo GIA assumem agora. Só contas do GIA (com matrícula): numa conta
-- local o nome é digitado por quem se cadastra. Ninguém é rebaixado aqui.
INSERT INTO workspace_members(workspace_id, user_id, role)
SELECT w.id, u.id, 'admin'
FROM org_unit_heads h
JOIN workspaces w ON w.org_unit = h.sigla
JOIN users u ON u.matricula IS NOT NULL AND projeta_name_key(u.name) = projeta_name_key(h.name)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'admin';
