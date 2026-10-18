import argparse
import hashlib
import json
import re
import unicodedata
import zipfile
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree


NAMESPACE = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
GROUP_COLUMNS = {
    0: "income",
    2: "monthly",
    4: "daily",
    6: "leisure",
    8: "reserve",
    10: "emergency",
    12: "limits",
}
EXPENSES = {
    "conta de agua": ("Moradia", "Conta de água", "fixed"),
    "conta de energia": ("Moradia", "Conta de energia", "fixed"),
    "internet": ("Serviços", "Internet", "fixed"),
    "streamings": ("Assinaturas", "Streaming", "fixed"),
    "creche": ("Família e educação", "Creche", "fixed"),
    "faculdade": ("Família e educação", "Faculdade", "fixed"),
    "recarga cel": ("Comunicação", "Recarga de celular", "fixed"),
    "caixinha crea": ("Profissional", "Caixinha CREA", "fixed"),
    "caixinha crt": ("Profissional", "Caixinha CRT", "fixed"),
    "feira": ("Alimentação", "Feira", "fixed"),
    "racao dos cachorros": ("Pets", "Ração dos cachorros", "fixed"),
    "gasolina": ("Transporte", "Combustível", "variable"),
    "pao": ("Alimentação", "Padaria", "variable"),
    "agua mineral": ("Alimentação", "Água mineral", "variable"),
    "gas de cozinha": ("Alimentação", "Gás de cozinha", "variable"),
    "feira complementos": ("Alimentação", "Feira - complementos", "variable"),
    "passeios": ("Lazer", "Passeios", "leisure"),
    "lanches": ("Lazer", "Lanches", "leisure"),
    "medicamentos": ("Saúde", "Medicamentos", "emergency"),
    "consultas": ("Saúde", "Consultas", "emergency"),
    "veterinario": ("Pets", "Veterinário", "emergency"),
}


def normalize(value):
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_marks).strip().casefold()


def column_index(cell_reference):
    letters = re.match(r"[A-Z]+", cell_reference).group()
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - ord("A") + 1
    return index - 1


def read_first_sheet(path):
    with zipfile.ZipFile(path) as workbook:
        shared_strings = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            strings_root = ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
            shared_strings = [
                "".join(node.text or "" for node in item.findall(".//x:t", NAMESPACE))
                for item in strings_root.findall("x:si", NAMESPACE)
            ]
        sheet = ElementTree.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        result = []
        for row in sheet.findall(".//x:sheetData/x:row", NAMESPACE):
            values = {}
            for cell in row.findall("x:c", NAMESPACE):
                cell_type = cell.get("t")
                if cell_type == "inlineStr":
                    value = "".join(node.text or "" for node in cell.findall(".//x:t", NAMESPACE))
                else:
                    raw = cell.find("x:v", NAMESPACE)
                    if raw is None:
                        continue
                    value = shared_strings[int(raw.text)] if cell_type == "s" else raw.text
                values[column_index(cell.get("r"))] = value
            result.append(values)
        return result


def amount_to_cents(value):
    if value is None or not value.strip():
        return None
    try:
        amount = Decimal(value.replace(",", "."))
    except InvalidOperation as error:
        raise ValueError(f"Valor de receita/despesa inválido: {value}") from error
    cents = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents <= 0:
        raise ValueError("Os valores preenchidos precisam ser maiores que zero.")
    return cents


def main():
    parser = argparse.ArgumentParser(
        description="Converte uma planilha .xlsx em um JSON local para prévia no Casa em Dia."
    )
    parser.add_argument("workbook", type=Path, help="Caminho da planilha .xlsx")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("household-initial-import.json"),
        help="Arquivo JSON local de saída (padrão: household-initial-import.json)",
    )
    args = parser.parse_args()
    if not args.workbook.is_file():
        parser.error("A planilha informada não existe.")

    rows = read_first_sheet(args.workbook)
    if not rows or not rows[0]:
        parser.error("A planilha não contém linhas para importar.")

    categories = {}
    recurring_items = []
    budget_targets = []
    allocation_notes = []
    excluded_invoice_items = []

    for row in rows[1:]:
        for column, group in GROUP_COLUMNS.items():
            title = str(row.get(column, "")).strip()
            if not title:
                continue
            amount_cents = amount_to_cents(row.get(column + 1))
            key = normalize(title)
            if group == "income":
                if key.startswith("salario"):
                    category, subcategory = "Trabalho", "Salário"
                elif "creche" in key:
                    category, subcategory = "Benefícios", "Auxílio-creche"
                elif "alimentacao" in key:
                    category, subcategory = "Benefícios", "Vale-alimentação"
                else:
                    category, subcategory = "Outros", "Outras receitas"
                budget_group = None
                transaction_type = "income"
                recurring_items.append({
                    "title": title,
                    "transaction_type": transaction_type,
                    "category": category,
                    "subcategory": subcategory,
                    "budget_group": budget_group,
                    "amount_cents": amount_cents,
                    "frequency": "monthly",
                    "day_of_month": 1,
                    "month_of_year": None,
                })
            elif group == "monthly":
                if key.startswith("fatura cartao"):
                    excluded_invoice_items.append(title)
                    continue
                category, subcategory, budget_group = EXPENSES.get(
                    key, ("Outros", title[:60], "fixed")
                )
                transaction_type = "expense"
                recurring_items.append({
                    "title": title,
                    "transaction_type": transaction_type,
                    "category": category,
                    "subcategory": subcategory,
                    "budget_group": budget_group,
                    "amount_cents": amount_cents,
                    "frequency": "monthly",
                    "day_of_month": 1,
                    "month_of_year": None,
                })
            elif group in ("daily", "leisure", "emergency"):
                category, subcategory, budget_group = EXPENSES.get(
                    key, ("Outros", title[:60], group if group != "daily" else "variable")
                )
                transaction_type = "expense"
            elif group == "reserve":
                allocation_notes.append({
                    "title": title,
                    "amount_cents": amount_cents,
                    "description": "A reserva é um movimento de alocação, não uma despesa de consumo.",
                })
                continue
            else:
                target_map = [
                    ("limite do cartao", "card_limit"),
                    ("limites de despesas mensais", "monthly_limit"),
                    ("limites de despesas diarias", "daily_limit"),
                    ("limites de despesas de lazer", "leisure_limit"),
                    ("valor objetivo de reserva mensal", "monthly_reserve_target"),
                    ("valor reservado exclusivamente para emergencias", "emergency_fund_goal"),
                ]
                target_type = next((kind for prefix, kind in target_map if key.startswith(prefix)), None)
                if target_type is None:
                    target_type = "monthly_limit"
                related_card_label = None
                if target_type == "card_limit":
                    related_card_label = "Lanna" if "lanna" in key else "Leo"
                budget_targets.append({
                    "target_type": target_type,
                    "label": title,
                    "amount_cents": amount_cents,
                    "related_card_label": related_card_label,
                })
                continue

            category_row = {
                "transaction_type": transaction_type,
                "category": category,
                "subcategory": subcategory,
                "budget_group": budget_group,
            }
            categories[(
                transaction_type, category, subcategory
            )] = category_row

    if not recurring_items:
        parser.error("Não foi encontrada nenhuma receita ou despesa mensal.")

    payload = {
        "version": 1,
        "source_name": args.workbook.name,
        "source_fingerprint": hashlib.sha256(args.workbook.read_bytes()).hexdigest(),
        "categories": list(categories.values()),
        "recurring_items": recurring_items,
        "budget_targets": budget_targets,
        "allocation_notes": allocation_notes,
        "excluded_invoice_items": excluded_invoice_items,
    }
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Arquivo de prévia preparado localmente: {args.output} "
        f"({len(recurring_items)} itens recorrentes, "
        f"{len(categories)} categorias, {len(budget_targets)} metas/limites)."
    )


if __name__ == "__main__":
    main()
