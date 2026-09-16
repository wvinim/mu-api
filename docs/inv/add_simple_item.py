"""
Adiciona um item simples (sem level, sem opções) ao primeiro slot vazio
do inventário de um personagem, direto na coluna Inventory (VARBINARY).

Formato assumido: ItemDbByte = 16, INVENTORY_SIZE = 108, MAX_SUBTYPE_ITEMS = 512.

ATENÇÃO: valide sempre em um personagem de teste antes de usar em produção.
Compare o resultado com dump_inventory_slots.py contra um item pego manualmente
no jogo, para confirmar que o layout dos bytes 11-15 está correto no seu servidor.
"""

import pyodbc

ITEM_DB_BYTE = 16
INVENTORY_SIZE = 108
MAX_SUBTYPE_ITEMS = 512

# Os primeiros 12 slots (0-11) são os slots de EQUIPAMENTO (capacete, armadura,
# armas, asas, anéis, etc.) -- NUNCA inserir itens de loja ali.
# A mochila real vai de 12 até 75 (MAIN_INVENTORY_SIZE = 76 no total, incluindo
# os 12 de equipamento: 12 + 64 = 76).
# Slots 76-107 ficam fora de MAIN_INVENTORY_RANGE e têm propósito não confirmado
# neste projeto -- evitamos mexer neles também.
BAG_START_SLOT = 12
BAG_END_SLOT = 76  # exclusivo


def _make_slot_bytes(item_group: int, item_index: int, quantity: int = 1, item_level: int = 0) -> bytes:
    """Monta os 16 bytes de um slot simples (jóia/box): sem opções especiais.

    item_level é usado por itens tipo "Bundle of Jewel of Bless", onde o
    level determina a variante (ex: level 0 = 10 unidades, 1 = 20, 2 = 30).
    Para jóias avulsas (não-bundle), deixe item_level=0 e use quantity
    para a pilha.
    """
    item_type = (item_group * MAX_SUBTYPE_ITEMS) + item_index

    slot = bytearray(ITEM_DB_BYTE)  # inicia com 16 zeros

    slot[0] = item_type & 0xFF                                   # DBI_TYPE
    slot[1] = (item_level & 0x0F) << 3                           # DBI_OPTION_DATA (level nos bits 3-6)
    slot[2] = min(quantity, 255)                                 # DBI_DUR (quantidade empilhada)
    slot[3] = 0                                                  # DBI_SERIAL1
    slot[4] = 0                                                  # DBI_SERIAL2
    slot[5] = 0                                                  # DBI_SERIAL3
    slot[6] = 0                                                  # DBI_SERIAL4
    slot[7] = 0x80 if (item_type & 0x100) else 0                 # DBI_NOPTION_DATA (bit7 = extensão do type)
    slot[8] = 0                                                  # DBI_SOPTION_DATA
    slot[9] = ((item_type & 0x1E00) >> 5) & 0xF0                 # DBI_OPTION380_DATA (extensão do type)
    slot[10] = 0                                                 # DBI_JOH_DATA
    # bytes 11-15 permanecem 0x00 -- confirmado via dump_inventory_slots.py

    return bytes(slot)


def _find_empty_slot(inventory: bytes) -> int:
    """Retorna o índice do primeiro slot VAZIO dentro da mochila real
    (slots 12 a 75), ignorando slots de equipamento e a área acima de 75.
    Retorna -1 se a mochila estiver cheia."""
    for n in range(BAG_START_SLOT, BAG_END_SLOT):
        offset = n * ITEM_DB_BYTE
        slot = inventory[offset:offset + ITEM_DB_BYTE]

        byte0 = slot[0]
        byte7 = slot[7]
        byte9 = slot[9]

        is_empty = (byte0 == 0xFF and (byte7 & 0x80) == 0x80 and (byte9 & 0xF0) == 0xF0)

        if is_empty:
            return n

    return -1


def add_simple_item_to_inventory(conn: "pyodbc.Connection", char_name: str,
                                  item_group: int, item_index: int, quantity: int = 1,
                                  item_level: int = 0) -> bool:
    """
    Adiciona um item simples (jóia/box) ao inventário do personagem.

    Retorna True se inseriu com sucesso, False se o personagem não foi encontrado,
    o inventário estava cheio, ou o tamanho do blob não bateu com o esperado.
    """
    cursor = conn.cursor()

    cursor.execute("SELECT Inventory FROM Character WHERE Name = ?", char_name)
    row = cursor.fetchone()

    if row is None:
        return False  # personagem não encontrado

    inventory = row[0]  # bytes

    expected_len = ITEM_DB_BYTE * INVENTORY_SIZE
    if len(inventory) != expected_len:
        # tamanho inesperado -- não arrisca escrever em cima de um formato desconhecido
        return False

    slot_index = _find_empty_slot(inventory)

    if slot_index == -1:
        return False  # inventário cheio

    new_slot = _make_slot_bytes(item_group, item_index, quantity, item_level)

    offset = slot_index * ITEM_DB_BYTE
    new_inventory = inventory[:offset] + new_slot + inventory[offset + ITEM_DB_BYTE:]

    cursor.execute(
        "UPDATE Character SET Inventory = ? WHERE Name = ?",
        pyodbc.Binary(new_inventory), char_name
    )
    conn.commit()

    return True


if __name__ == "__main__":
    # Exemplo de uso -- ajuste a connection string para o seu ambiente.
    conn_str = (
        "DRIVER={SQL Server Native Client 10.0};"
        "SERVER=;"
        "DATABASE=MuOnline;"
        "UID=sa;"
        "PWD=;"
    )

    conn = pyodbc.connect(conn_str)

    # Exemplo: Jewel of Bless (grupo 14, índice 13), quantidade 10, para o char "Teste"
    ok = add_simple_item_to_inventory(conn, "teste", item_group=12, item_index=30, quantity=1, item_level=0)
    ok = add_simple_item_to_inventory(conn, "teste", item_group=12, item_index=30, quantity=1, item_level=1)
    ok = add_simple_item_to_inventory(conn, "teste", item_group=12, item_index=30, quantity=1, item_level=2)

    print("Item adicionado com sucesso." if ok else "Falha ao adicionar item.")
