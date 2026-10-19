"""Safe command-line SymPy adapter for MathApp.

Expressions are parsed as Python ASTs and interpreted from a small, explicit
mathematical whitelist.  In particular, this module never evaluates user
expressions with ``eval``, ``sympify`` or ``parse_expr``.
"""

import ast
import io
import json
import math
import re
import sys
import tokenize

import sympy as sp

try:  # pragma: no cover - the fallback only matters on exotic builds
    from sympy.calculus.util import continuous_domain as _continuous_domain
except Exception:
    _continuous_domain = None


MAX_EXPR_LENGTH = 4096
MAX_TOKENS = 512
MAX_AST_NODES = 512
MAX_MATRIX_DIMENSION = 20
MAX_POWER = 1000
MAX_SYMBOLIC_POWER = 128
MAX_SPECIAL_ARGUMENT = 1000
MAX_SERIES_ORDER = 100

OPERATIONS = {
    "simplify", "diff", "integrate", "limit", "series", "expand", "factor",
    "apart", "together", "solve", "dsolve", "det", "inverse", "transpose",
    "eigenvals", "eigenvects", "rank", "rref", "evaluate", "latex",
    "studio",
    "stats", "regressione", "complesso", "parziali", "sistema",
    "dot", "cross", "norm", "angle", "projection", "independence",
    "gram_schmidt",
}

VECTOR_OPERATIONS = {
    "dot", "cross", "norm", "angle", "projection", "independence",
    "gram_schmidt",
}

SAFE_FUNCTIONS = {
    "sin": sp.sin,
    "cos": sp.cos,
    "tan": sp.tan,
    "cot": sp.cot,
    "sec": sp.sec,
    "csc": sp.csc,
    "asin": sp.asin,
    "acos": sp.acos,
    "atan": sp.atan,
    "sinh": sp.sinh,
    "cosh": sp.cosh,
    "tanh": sp.tanh,
    "asinh": sp.asinh,
    "acosh": sp.acosh,
    "atanh": sp.atanh,
    "exp": sp.exp,
    "log": sp.log,
    "ln": sp.log,
    "sqrt": sp.sqrt,
    "abs": sp.Abs,
    "Abs": sp.Abs,
    "floor": sp.floor,
    "ceiling": sp.ceiling,
    "sign": sp.sign,
    "factorial": sp.factorial,
    "gamma": sp.gamma,
    "erf": sp.erf,
    "Min": sp.Min,
    "Max": sp.Max,
    "Derivative": sp.Derivative,
    "Integral": sp.Integral,
}

CONSTANTS = {
    "pi": sp.pi,
    "Pi": sp.pi,
    "E": sp.E,
    "e": sp.E,
    "I": sp.I,
    "i": sp.I,
    "oo": sp.oo,
    "inf": sp.oo,
    "zoo": sp.zoo,
    "nan": sp.nan,
    "True": sp.true,
    "False": sp.false,
}

_BIN_OPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.Pow: lambda a, b: a ** b,
    ast.Mod: lambda a, b: sp.Mod(a, b),
}
_UNARY_OPS = {
    ast.UAdd: lambda value: value,
    ast.USub: lambda value: -value,
    ast.Not: lambda value: sp.Not(value),
}
_COMPARE_OPS = {
    ast.Eq: sp.Eq,
    ast.NotEq: sp.Ne,
    ast.Lt: sp.Lt,
    ast.LtE: sp.Le,
    ast.Gt: sp.Gt,
    ast.GtE: sp.Ge,
}


class UnsafeExpression(ValueError):
    """Raised when input uses syntax outside the mathematical grammar."""


def _valid_identifier(name):
    return (
        isinstance(name, str)
        and len(name) <= 64
        and name.isidentifier()
        and not name.startswith("__")
    )


def _tokens_for(source):
    if not isinstance(source, str):
        raise UnsafeExpression("l'espressione deve essere testo")
    source = source.strip()
    if not source:
        raise UnsafeExpression("espressione vuota")
    if len(source) > MAX_EXPR_LENGTH:
        raise UnsafeExpression("espressione troppo lunga")

    # Accetta alcune notazioni comuni senza ampliare la grammatica di Python.
    source = source.replace("−", "-").replace("×", "*").replace("÷", "/")
    source = source.replace("^", "**")

    try:
        raw = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError) as exc:
        raise UnsafeExpression("sintassi matematica non valida") from exc

    tokens = []
    for token in raw:
        if token.type in (tokenize.ENDMARKER, tokenize.NEWLINE, tokenize.NL,
                          tokenize.INDENT, tokenize.DEDENT):
            continue
        if token.type in (tokenize.STRING, tokenize.COMMENT, tokenize.ERRORTOKEN):
            raise UnsafeExpression("stringhe e sintassi Python non sono ammesse")
        tokens.append(token)
    if len(tokens) > MAX_TOKENS:
        raise UnsafeExpression("espressione troppo complessa")

    # Moltiplicazione implicita: 2x, 2(x+1), (x+1)(x-1), xy.
    # NAME '(' resta una chiamata; l'interprete la limiterà a funzioni note o
    # a funzioni simboliche innocue.
    rendered = []
    previous = None
    for token in tokens:
        if previous is not None:
            left_can_end = (
                previous.type in (tokenize.NUMBER, tokenize.NAME)
                or previous.string in (")", "]", "}")
            )
            right_can_start = (
                token.type in (tokenize.NUMBER, tokenize.NAME)
                or token.string in ("(", "[", "{")
            )
            is_named_call = previous.type == tokenize.NAME and token.string == "("
            if left_can_end and right_can_start and not is_named_call:
                rendered.append("*")
        rendered.append(token.string)
        previous = token
    return " ".join(rendered)


class SafeMathParser:
    def __init__(self, variable="x"):
        if not _valid_identifier(variable):
            raise UnsafeExpression("variabile non valida")
        self.variable = variable
        self.symbols = {variable: sp.Symbol(variable)}
        self.undefined_functions = {}

    def parse(self, source):
        normalized = _tokens_for(source)

        # La CLI storicamente accetta anche equazioni scritte con un solo '=';
        # trasformale in lhs-rhs senza trattarle come Python assignment.
        match = re.search(r"(?<![<>=!])=(?!=)", normalized)
        if match:
            lhs = normalized[:match.start()].strip()
            rhs = normalized[match.end():].strip()
            if not lhs or not rhs:
                raise UnsafeExpression("equazione incompleta")
            return self._parse_ast(lhs) - self._parse_ast(rhs)
        return self._parse_ast(normalized)

    def _parse_ast(self, source):
        try:
            tree = ast.parse(source, mode="eval")
        except (SyntaxError, ValueError, MemoryError, RecursionError) as exc:
            raise UnsafeExpression("sintassi matematica non valida") from exc
        if sum(1 for _ in ast.walk(tree)) > MAX_AST_NODES:
            raise UnsafeExpression("espressione troppo complessa")
        try:
            return self._visit(tree.body)
        except (ArithmeticError, TypeError, ValueError, RecursionError) as exc:
            if isinstance(exc, UnsafeExpression):
                raise
            raise UnsafeExpression(str(exc) or "espressione non valida") from exc

    def _visit(self, node):
        if isinstance(node, ast.Constant):
            value = node.value
            if isinstance(value, bool):
                return sp.true if value else sp.false
            if isinstance(value, int):
                return sp.Integer(value)
            if isinstance(value, float):
                return sp.Rational(str(value))
            if isinstance(value, complex):
                return sp.Float(value.real) + sp.Float(value.imag) * sp.I
            raise UnsafeExpression("tipo di costante non ammesso")

        if isinstance(node, ast.Name):
            if node.id.startswith("__"):
                raise UnsafeExpression("nome non ammesso")
            if node.id in CONSTANTS:
                return CONSTANTS[node.id]
            if node.id in self.undefined_functions:
                raise UnsafeExpression("una funzione simbolica richiede argomenti")
            if not _valid_identifier(node.id):
                raise UnsafeExpression("nome non valido")
            if node.id not in self.symbols:
                if len(self.symbols) >= 128:
                    raise UnsafeExpression("troppe variabili")
                self.symbols[node.id] = sp.Symbol(node.id)
            return self.symbols[node.id]

        if isinstance(node, ast.BinOp):
            left = self._visit(node.left)
            right = self._visit(node.right)
            if isinstance(node.op, ast.BitOr):
                if isinstance(left, sp.Set) and isinstance(right, sp.Set):
                    return left.union(right)
                raise UnsafeExpression("'|' è ammesso solo tra insiemi")
            if isinstance(node.op, ast.BitAnd):
                if isinstance(left, sp.Set) and isinstance(right, sp.Set):
                    return left.intersect(right)
                raise UnsafeExpression("'&' è ammesso solo tra insiemi")
            operation = _BIN_OPS.get(type(node.op))
            if operation is None:
                raise UnsafeExpression("operatore non ammesso")
            if isinstance(node.op, ast.Pow) and right.is_Integer:
                effective_power = right
                if isinstance(left, sp.Pow) and left.exp.is_Integer:
                    effective_power = left.exp * right
                if abs(effective_power) > MAX_POWER:
                    raise UnsafeExpression("esponente intero supera il limite")
                if not left.is_number and abs(effective_power) > MAX_SYMBOLIC_POWER:
                    raise UnsafeExpression("esponente simbolico supera il limite")
            return operation(left, right)

        if isinstance(node, ast.UnaryOp):
            operation = _UNARY_OPS.get(type(node.op))
            if operation is None:
                raise UnsafeExpression("operatore unario non ammesso")
            return operation(self._visit(node.operand))

        if isinstance(node, ast.Compare):
            left = self._visit(node.left)
            relations = []
            for op, comparator in zip(node.ops, node.comparators):
                right = self._visit(comparator)
                relation = _COMPARE_OPS.get(type(op))
                if relation is None:
                    raise UnsafeExpression("confronto non ammesso")
                relations.append(relation(left, right, evaluate=False))
                left = right
            return relations[0] if len(relations) == 1 else sp.And(*relations)

        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise UnsafeExpression("chiamate indirette non ammesse")
            name = node.func.id
            if name.startswith("__") or not _valid_identifier(name):
                raise UnsafeExpression("nome di funzione non ammesso")
            if node.keywords:
                raise UnsafeExpression("argomenti nominati non ammessi")
            args = [self._visit(arg) for arg in node.args]
            function = SAFE_FUNCTIONS.get(name)
            if function is not None:
                if name in ("factorial", "gamma") and args and args[0].is_number:
                    try:
                        numeric_arg = float(args[0])
                    except (OverflowError, TypeError, ValueError) as exc:
                        raise UnsafeExpression(f"argomento di {name} fuori limite") from exc
                    if not math.isfinite(numeric_arg) or abs(numeric_arg) > MAX_SPECIAL_ARGUMENT:
                        raise UnsafeExpression(f"argomento di {name} supera il limite")
                    if name == "factorial" and args[0].is_Integer and int(args[0]) < 0:
                        raise UnsafeExpression("argomento di factorial fuori limite")
                return function(*args)

            # Se il nome è già una variabile (es. x(x+1)), NAME '(' significa
            # moltiplicazione implicita. Gli altri nomi diventano funzioni
            # simboliche SymPy, non funzioni Python.
            if name in self.symbols:
                if len(args) != 1:
                    raise UnsafeExpression("moltiplicazione implicita con un solo argomento")
                return self.symbols[name] * args[0]
            function = self.undefined_functions.setdefault(name, sp.Function(name))
            return function(*args)

        if isinstance(node, ast.Tuple):
            return tuple(self._visit(item) for item in node.elts)

        if isinstance(node, ast.List):
            return [self._visit(item) for item in node.elts]

        if isinstance(node, ast.Set):
            return sp.FiniteSet(*(self._visit(item) for item in node.elts))

        # Attribute access, indexing, comprehensions, lambdas, dicts and every
        # other Python construct are deliberately outside the grammar.
        raise UnsafeExpression("costrutto non ammesso nell'espressione matematica")


def _int_option(value, default, name, minimum=0, maximum=MAX_SERIES_ORDER):
    if value is None:
        value = default
    if isinstance(value, bool):
        raise UnsafeExpression(f"{name} non valido")
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise UnsafeExpression(f"{name} non valido") from exc
    if str(value).strip() not in (str(number), f"+{number}"):
        raise UnsafeExpression(f"{name} deve essere un intero")
    if not minimum <= number <= maximum:
        raise UnsafeExpression(f"{name} fuori limite")
    return number


def _matrix_from(value):
    if not isinstance(value, list) or not value:
        raise UnsafeExpression("matrice non valida: usa una lista di righe")
    if len(value) > MAX_MATRIX_DIMENSION:
        raise UnsafeExpression("matrice troppo grande")
    if not all(isinstance(row, list) for row in value):
        raise UnsafeExpression("matrice non valida: ogni riga deve essere una lista")
    width = len(value[0])
    if width < 1 or width > MAX_MATRIX_DIMENSION or any(len(row) != width for row in value):
        raise UnsafeExpression("matrice non rettangolare o troppo grande")
    return sp.Matrix(value)


# ---------------------------------------------------------------------------
# Vettori: prodotto scalare/vettoriale, norma, angolo, proiezione,
# indipendenza lineare e Gram-Schmidt.  Input: lista di vettori numerici,
# es. [[1,2],[3,4]] (campo "vectors", fallback "matrix"/"expr").


def _vector_rows(value):
    """Interpret a nested list as a grid of numeric row vectors."""
    if not isinstance(value, (list, tuple)) or not value:
        raise UnsafeExpression("vettori non validi: usa una lista come [[1,2],[3,4]]")
    value = list(value)
    if not any(isinstance(item, (list, tuple)) for item in value):
        value = [value]
    if not all(isinstance(row, (list, tuple)) for row in value):
        raise UnsafeExpression("ogni vettore deve essere una lista, es. [[1,2],[3,4]]")
    if len(value) > MAX_MATRIX_DIMENSION:
        raise UnsafeExpression("troppi vettori: il limite è %d" % MAX_MATRIX_DIMENSION)
    dimension = len(value[0])
    if dimension < 1 or dimension > MAX_MATRIX_DIMENSION:
        raise UnsafeExpression("dimensione dei vettori fuori limite")
    if any(len(row) != dimension for row in value):
        raise UnsafeExpression("i vettori devono avere tutti la stessa dimensione")
    vectors = []
    for row in value:
        entries = []
        for item in row:
            if isinstance(item, bool):
                raise UnsafeExpression("i vettori devono contenere numeri")
            if isinstance(item, int):
                item = sp.Integer(item)
            elif isinstance(item, float):
                item = sp.Rational(str(item))
            if not isinstance(item, sp.Basic) or item.is_number is not True:
                raise UnsafeExpression("i vettori devono contenere numeri")
            entries.append(item)
        vectors.append(entries)
    return vectors


def _vector_text(entries):
    return "(" + ", ".join(_display(entry) for entry in entries) + ")"


def _vector_latex(entries):
    return r"\left(" + ", ".join(_latex(entry) for entry in entries) + r"\right)"


def _numeric_components(entries):
    """Convert a list of SymPy numbers into JSON-friendly real numbers."""
    numbers = []
    for entry in entries:
        if getattr(entry, "is_real", None) is not True:
            return None
        try:
            number = float(sp.N(entry, 12))
        except (TypeError, ValueError, OverflowError):
            return None
        if not math.isfinite(number):
            return None
        if abs(number) < 1e15 and abs(number - round(number)) < 1e-9:
            number = int(round(number))
        else:
            number = round(number, 10)
        numbers.append(number)
    return numbers


def _vector_draw(entries_list):
    """Build the drawing payload for a handful of 2D/3D vectors."""
    vectors = []
    dimension = None
    for label, entries in entries_list:
        numbers = _numeric_components(entries)
        if numbers is None or len(numbers) not in (2, 3):
            return None
        if dimension is None:
            dimension = len(numbers)
        elif dimension != len(numbers):
            return None
        vectors.append({"label": label, "components": numbers})
    if not vectors:
        return None
    return {"dimension": dimension, "vettori": vectors}


def _null_relation(coeffs, labels):
    """Format one dependence relation like  v3 = v1 + v2  from nullspace
    coefficients."""
    index = None
    for position, coeff in enumerate(coeffs):
        if coeff != 0:
            index = position
    if index is None:
        return None
    terms = []
    for position, coeff in enumerate(coeffs):
        if position == index or coeff == 0:
            continue
        factor = sp.simplify(-coeff / coeffs[index])
        if factor == 1:
            terms.append(labels[position])
        elif factor == -1:
            terms.append("-" + labels[position])
        else:
            terms.append(_display(factor) + " * " + labels[position])
    if not terms:
        return labels[index] + " = 0"
    text = labels[index] + " = "
    for position, term in enumerate(terms):
        negative = term.startswith("-")
        body = term[1:] if negative else term
        if position == 0:
            text += ("-" if negative else "") + body
        else:
            text += (" - " if negative else " + ") + body
    return text


def _vector_operation(operation, args, parser):
    source = args.get("vectors")
    if source is None:
        source = args.get("matrix")
    if source is None:
        source = args.get("expr")
    if source is None:
        raise UnsafeExpression("vettori mancanti: usa una lista come [[1,2],[3,4]]")
    if isinstance(source, (list, tuple)):
        parsed = source
    else:
        parsed = parser.parse(str(source))
    vectors = _vector_rows(parsed)
    dimension = len(vectors[0])
    labels = ["v%d" % (index + 1) for index in range(len(vectors))]
    listing = [_vector_text(entries) for entries in vectors]

    if operation == "dot":
        if len(vectors) != 2:
            raise UnsafeExpression("il prodotto scalare richiede esattamente 2 vettori")
        value = sp.simplify(sum(a * b for a, b in zip(vectors[0], vectors[1])))
        return {
            "ok": True,
            "kind": "vettori",
            "result": "v1 · v2 = " + _display(value),
            "latex": r"v_1 \cdot v_2 = " + _latex(value),
            "vettori": listing,
            "draw": _vector_draw([("v1", vectors[0]), ("v2", vectors[1])]),
        }

    if operation == "cross":
        if len(vectors) != 2 or dimension != 3:
            raise UnsafeExpression(
                "il prodotto vettoriale richiede esattamente 2 vettori in R^3")
        cross = sp.Matrix(vectors[0]).cross(sp.Matrix(vectors[1]))
        entries = [sp.simplify(cross[index]) for index in range(3)]
        return {
            "ok": True,
            "kind": "vettori",
            "result": "v1 × v2 = " + _vector_text(entries),
            "latex": r"v_1 \times v_2 = " + _vector_latex(entries),
            "vettori": listing,
            "draw": _vector_draw([
                ("v1", vectors[0]),
                ("v2", vectors[1]),
                ("v1 × v2", entries),
            ]),
        }

    if operation == "norm":
        if len(vectors) != 1:
            raise UnsafeExpression("la norma richiede esattamente 1 vettore")
        value = sp.sqrt(sum(entry ** 2 for entry in vectors[0]))
        try:
            value = sp.simplify(value)
        except Exception:
            pass
        return {
            "ok": True,
            "kind": "vettori",
            "result": "|v1| = " + _display(value),
            "latex": r"\left| v_1 \right| = " + _latex(value),
            "vettori": listing,
            "draw": _vector_draw([("v1", vectors[0])]),
        }

    if operation == "angle":
        if len(vectors) != 2:
            raise UnsafeExpression("l'angolo richiede esattamente 2 vettori")
        first, second = vectors
        norm_first = sp.sqrt(sum(entry ** 2 for entry in first))
        norm_second = sp.sqrt(sum(entry ** 2 for entry in second))
        try:
            norm_first = sp.simplify(norm_first)
            norm_second = sp.simplify(norm_second)
        except Exception:
            pass
        if norm_first == 0 or norm_second == 0:
            raise UnsafeExpression("angolo non definito: uno dei vettori è nullo")
        cosine = sum(a * b for a, b in zip(first, second)) / (norm_first * norm_second)
        try:
            cosine = sp.simplify(cosine)
        except Exception:
            pass
        angle_value = sp.acos(cosine)
        payload = {
            "ok": True,
            "kind": "vettori",
            "result": "angolo tra v1 e v2 = " + _display(angle_value),
            "latex": (r"\theta = \arccos\left(\frac{v_1 \cdot v_2}"
                      r"{|v_1|\,|v_2|}\right) = " + _latex(angle_value)),
            "vettori": listing,
            "draw": _vector_draw([("v1", first), ("v2", second)]),
        }
        try:
            if angle_value.is_number and angle_value.is_real:
                radians = sp.N(angle_value, 6)
                degrees = sp.N(angle_value * 180 / sp.pi, 5)
                payload["note"] = ("valori approssimati: %s rad = %s°"
                                   % (sp.sstr(radians), sp.sstr(degrees)))
        except Exception:
            pass
        return payload

    if operation == "projection":
        if len(vectors) != 2:
            raise UnsafeExpression("la proiezione richiede esattamente 2 vettori")
        first, second = vectors
        squared = sp.simplify(sum(entry ** 2 for entry in second))
        if squared == 0:
            raise UnsafeExpression("proiezione non definita: il secondo vettore è nullo")
        scalar = sp.simplify(
            sum(a * b for a, b in zip(first, second)) / squared)
        projection = [sp.simplify(scalar * entry) for entry in second]
        return {
            "ok": True,
            "kind": "vettori",
            "result": "proiezione di v1 su v2 = " + _vector_text(projection),
            "latex": (r"\pi_{v_2}(v_1) = \frac{v_1 \cdot v_2}{|v_2|^2}\, v_2 = "
                      + _vector_latex(projection)),
            "note": "coefficiente = (v1 · v2) / |v2|^2 = " + _display(scalar),
            "vettori": listing,
            "draw": _vector_draw([
                ("v1", first),
                ("v2", second),
                ("proiezione", projection),
            ]),
        }

    if operation == "independence":
        matrix = sp.Matrix(vectors)
        rank = matrix.rank()
        count = len(vectors)
        if rank == count:
            result_text = ("%d vettori in R^%d: linearmente indipendenti"
                           % (count, dimension))
            if count == dimension:
                note = "rango %d: formano una base di R^%d" % (rank, dimension)
            else:
                note = "rango %d: lo spazio generato ha dimensione %d" % (rank, rank)
        else:
            result_text = ("%d vettori in R^%d: linearmente dipendenti (rango %d)"
                           % (count, dimension, rank))
            relations = []
            try:
                for vector in matrix.T.nullspace():
                    coeffs = [sp.simplify(vector[index]) for index in range(vector.rows)]
                    relation = _null_relation(coeffs, labels)
                    if relation:
                        relations.append(relation)
            except Exception:
                relations = []
            if relations:
                note = "; ".join(relations)
            else:
                note = "rango %d: esistono combinazioni non banali" % rank
        return {
            "ok": True,
            "kind": "vettori",
            "result": result_text,
            "latex": r"\text{rango} = %d" % rank,
            "note": note,
            "vettori": listing,
            "draw": _vector_draw(list(zip(labels, vectors))),
        }

    if operation == "gram_schmidt":
        matrix = sp.Matrix(vectors)
        rank = matrix.rank()
        if rank < len(vectors):
            raise UnsafeExpression(
                "gram_schmidt richiede vettori linearmente indipendenti "
                "(rango %d su %d)" % (rank, len(vectors)))
        try:
            orthogonal = sp.GramSchmidt(
                [sp.Matrix(entries) for entries in vectors], orthonormal=False)
        except Exception as exc:
            raise UnsafeExpression("gram_schmidt non riuscito: %s" % exc)
        q_vectors = []
        for vector in orthogonal:
            q_vectors.append([sp.simplify(entry) for entry in list(vector)])
        e_vectors = []
        for entries in q_vectors:
            norm_value = sp.sqrt(sum(entry ** 2 for entry in entries))
            try:
                norm_value = sp.simplify(norm_value)
            except Exception:
                pass
            e_vectors.append([sp.simplify(entry / norm_value) for entry in entries])
        q_labels = ["q%d" % (index + 1) for index in range(len(q_vectors))]
        e_labels = ["e%d" % (index + 1) for index in range(len(e_vectors))]
        q_text = ", ".join(label + " = " + _vector_text(entries)
                           for label, entries in zip(q_labels, q_vectors))
        e_text = ", ".join(label + " = " + _vector_text(entries)
                           for label, entries in zip(e_labels, e_vectors))
        return {
            "ok": True,
            "kind": "vettori",
            "result": "base ortogonale: " + q_text,
            "latex": ", \\quad ".join(label + " = " + _vector_latex(entries)
                                      for label, entries in zip(q_labels, q_vectors)),
            "note": "base ortonormale: " + e_text,
            "vettori": listing,
            "draw": _vector_draw(
                list(zip(labels, vectors)) + list(zip(q_labels, q_vectors))),
        }

    raise UnsafeExpression("operazione vettoriale non supportata")


# ---------------------------------------------------------------------------
# Studio di funzione


def _ordered_union_args(value):
    arguments = list(value.args)
    if all(isinstance(argument, sp.Interval) for argument in arguments):
        try:
            arguments.sort(key=lambda interval: float(interval.start))
        except (TypeError, ValueError, OverflowError):
            pass
    return arguments


def _is_finite_number(value):
    if not isinstance(value, sp.Basic):
        return False
    if getattr(value, "is_number", None) is not True:
        return False
    return getattr(value, "is_finite", None) is True


def _set_text(value):
    if value == sp.S.Reals:
        return "R (tutti i numeri reali)"
    if isinstance(value, sp.Union):
        return " U ".join(_set_text(argument)
                          for argument in _ordered_union_args(value))
    if isinstance(value, sp.Interval):
        left = "-inf" if value.start == -sp.oo else _display(value.start)
        right = "+inf" if value.end == sp.oo else _display(value.end)
        opening = "(" if value.left_open else "["
        closing = ")" if value.right_open else "]"
        return opening + left + ", " + right + closing
    return _display(value)


def _set_latex(value):
    if value == sp.S.Reals:
        return r"\mathbb{R}"
    if isinstance(value, sp.Union):
        return r" \cup ".join(_set_latex(argument)
                              for argument in _ordered_union_args(value))
    if isinstance(value, sp.Interval):
        left = r"-\infty" if value.start == -sp.oo else _latex(value.start)
        right = r"+\infty" if value.end == sp.oo else _latex(value.end)
        opening = r"\left(" if value.left_open else r"\left["
        closing = r"\right)" if value.right_open else r"\right]"
        return opening + left + ", " + right + closing
    return _latex(value)


def _domain_of(expression, variable):
    if _continuous_domain is None:
        return None
    try:
        return _continuous_domain(expression, variable, sp.S.Reals)
    except Exception:
        return None


def _interval_list(domain):
    """Extract (start, end, left_open, right_open) tuples from a domain set."""
    if domain is None:
        return None
    if domain == sp.S.Reals:
        return [(-sp.oo, sp.oo, True, True)]
    if isinstance(domain, sp.Interval):
        return [(domain.start, domain.end, domain.left_open, domain.right_open)]
    if isinstance(domain, sp.Union):
        intervals = []
        for argument in _ordered_union_args(domain):
            if not isinstance(argument, sp.Interval):
                return None
            intervals.append((argument.start, argument.end,
                              argument.left_open, argument.right_open))
        return intervals
    return None


def _ggb_expr(value):
    """Render a SymPy object as a GeoGebra-ready expression."""
    text = sp.sstr(value)
    text = text.replace("**", "^")
    text = text.replace("Abs(", "abs(")
    text = re.sub(r"\blog\(", "ln(", text)
    text = re.sub(r"\bE\b", "e", text)
    return text


def _ggb_line(slope, offset):
    if slope == 1:
        slope_part = "x"
    elif slope == -1:
        slope_part = "-x"
    else:
        slope_part = _ggb_expr(slope) + " * x"
    offset = sp.simplify(offset)
    if offset == 0:
        return "y = " + slope_part
    if offset.could_extract_minus_sign():
        return "y = %s - %s" % (slope_part, _ggb_expr(-offset))
    return "y = %s + %s" % (slope_part, _ggb_expr(offset))


def _oblique_text(slope, offset):
    if slope == 1:
        head = "x"
    elif slope == -1:
        head = "-x"
    else:
        head = _display(slope) + " * x"
    offset = sp.simplify(offset)
    if offset == 0:
        return "y = " + head
    if offset.could_extract_minus_sign():
        return "y = %s - %s" % (head, _display(-offset))
    return "y = %s + %s" % (head, _display(offset))


def _strip_function_prefix(raw, default_variable):
    text = raw.strip()
    match = re.match(
        r"^(?:y|[fgh]\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\))\s*=(?!=)\s*",
        text)
    if not match:
        return text, default_variable
    variable = match.group(1) or default_variable
    return text[match.end():].strip(), variable


def _studio_compute(args, parser):
    raw = args.get("expr")
    if raw is None:
        raise UnsafeExpression("espressione mancante")
    raw_text, variable_name = _strip_function_prefix(str(raw), parser.variable)
    if not raw_text:
        raise UnsafeExpression("espressione mancante")
    if variable_name != parser.variable:
        parser = SafeMathParser(variable_name)
    expression = parser.parse(raw_text)
    if not isinstance(expression, sp.Basic):
        raise UnsafeExpression("espressione non valida per lo studio di funzione")
    x = parser.symbols[variable_name]
    function_label = "f(%s)" % variable_name
    expression_text = _display(expression)

    sections = []
    draw_points = []
    draw_lines = []

    def add_section(label, text, latex=""):
        sections.append({"label": label, "text": text, "latex": latex})

    add_section("Funzione",
                function_label + " = " + expression_text,
                function_label + " = " + _latex(expression))

    # --- dominio ----------------------------------------------------------
    domain = _domain_of(expression, x)
    if domain is not None:
        add_section("Dominio", _set_text(domain), _set_latex(domain))
    else:
        add_section("Dominio", "non determinato automaticamente")

    # --- simmetrie --------------------------------------------------------
    symmetry = None
    try:
        negated = expression.subs(x, -x)
        if sp.simplify(negated - expression) == 0:
            symmetry = "pari"
        elif sp.simplify(negated + expression) == 0:
            symmetry = "dispari"
    except Exception:
        symmetry = None
    if symmetry == "pari":
        add_section("Simmetrie",
                    "pari: f(-%s) = f(%s)" % (variable_name, variable_name),
                    "f(-%s) = f(%s)" % (variable_name, variable_name))
    elif symmetry == "dispari":
        add_section("Simmetrie",
                    "dispari: f(-%s) = -f(%s)" % (variable_name, variable_name),
                    "f(-%s) = -f(%s)" % (variable_name, variable_name))
    else:
        add_section("Simmetrie", "nessuna simmetria evidente")

    # --- zeri -------------------------------------------------------------
    zeros = None
    try:
        zeros = sp.solveset(expression, x, domain=sp.S.Reals)
    except Exception:
        zeros = None
    zero_values = None
    if zeros is not None and zeros == sp.S.EmptySet:
        zero_values = []
    elif isinstance(zeros, sp.FiniteSet):
        values = list(zeros)
        try:
            values.sort(key=float)
        except Exception:
            pass
        zero_values = values
    if zero_values is None:
        if zeros is None or isinstance(zeros, sp.ConditionSet):
            add_section("Zeri (asse x)", "non determinati automaticamente")
        else:
            add_section("Zeri (asse x)", _display(zeros)[:300])
    elif not zero_values:
        add_section("Zeri (asse x)", "nessuno zero reale")
    else:
        shown = zero_values[:20]
        text = ", ".join("x = " + _display(value) for value in shown)
        if len(zero_values) > 20:
            text += ", ..."
        add_section(
            "Zeri (asse x)", text,
            ", \\; ".join("x_{%d} = %s" % (index + 1, _latex(value))
                          for index, value in enumerate(shown)))
        for index, value in enumerate(shown[:20]):
            numbers = _numeric_components([value, sp.Integer(0)])
            if numbers:
                draw_points.append({"nome": "Z%d" % (index + 1),
                                    "x": numbers[0], "y": 0, "tipo": "zero"})

    # --- intersezione con l'asse y ----------------------------------------
    intercept = None
    try:
        intercept = sp.simplify(expression.subs(x, 0))
    except Exception:
        intercept = None
    if intercept is not None and _is_finite_number(intercept):
        rendered = _display(intercept)
        add_section("Intersezione con l'asse y",
                    "f(0) = %s, punto (0, %s)" % (rendered, rendered),
                    "f(0) = %s" % _latex(intercept))
        numbers = _numeric_components([sp.Integer(0), intercept])
        if numbers:
            draw_points.append({"nome": "A", "x": 0, "y": numbers[1],
                                "tipo": "asse y"})
    else:
        add_section("Intersezione con l'asse y",
                    "f non è definita in x = 0 (0 fuori dal dominio)")

    # --- segno ------------------------------------------------------------
    base_domain = domain if domain is not None else sp.S.Reals

    def _sign_set(comparison):
        try:
            result = sp.solveset(comparison, x, domain=base_domain)
        except Exception:
            try:
                result = sp.solveset(comparison, x, domain=sp.S.Reals)
            except Exception:
                return None
        if isinstance(result, sp.ConditionSet):
            return None
        return result

    def _sign_text(value):
        if value is None:
            return "non determinato automaticamente"
        if value == sp.S.EmptySet:
            return "mai nel dominio"
        return _set_text(value)

    def _sign_latex(value):
        if value is None or value == sp.S.EmptySet:
            return ""
        return _set_latex(value)

    positive = _sign_set(expression > 0)
    negative = _sign_set(expression < 0)
    if positive is None and negative is None:
        add_section("Segno", "non determinato automaticamente")
    else:
        sign_latex_parts = []
        if _sign_latex(positive):
            sign_latex_parts.append("f(x) > 0: " + _sign_latex(positive))
        if _sign_latex(negative):
            sign_latex_parts.append("f(x) < 0: " + _sign_latex(negative))
        add_section("Segno",
                    "f(x) > 0: %s; f(x) < 0: %s"
                    % (_sign_text(positive), _sign_text(negative)),
                    " \\quad ".join(sign_latex_parts))

    # --- limiti -----------------------------------------------------------
    intervals = _interval_list(domain)
    finite_candidates = {}
    has_negative_infinity = False
    has_positive_infinity = False
    if intervals is not None:
        for start, end, _left_open, _right_open in intervals:
            if start == -sp.oo:
                has_negative_infinity = True
            else:
                finite_candidates.setdefault(start, set()).add("+")
            if end == sp.oo:
                has_positive_infinity = True
            else:
                finite_candidates.setdefault(end, set()).add("-")
    else:
        has_negative_infinity = True
        has_positive_infinity = True
    try:
        ordered_points = sorted(finite_candidates, key=float)[:6]
    except Exception:
        ordered_points = sorted(finite_candidates, key=_display)[:6]

    def _try_limit(local_expression, point, direction="+-"):
        try:
            return sp.limit(local_expression, x, point, dir=direction)
        except Exception:
            return None

    def _limit_value_text(value):
        if value == sp.oo:
            return "+inf"
        if value == -sp.oo:
            return "-inf"
        return _display(value)

    limit_texts = []
    limit_latexes = []
    vertical_asymptotes = []
    for point in ordered_points:
        directions = [direction for direction in ("-", "+")
                      if direction in finite_candidates[point]]
        for direction in directions:
            value = _try_limit(expression, point, direction)
            label = "x -> %s%s" % (_display(point), direction)
            if value is None:
                limit_texts.append(label + ": non calcolabile")
                continue
            limit_texts.append(label + ": " + _limit_value_text(value))
            limit_latexes.append(
                r"\lim_{x \to %s^{%s}} f(x) = %s"
                % (_latex(point), direction, _latex(value)))
            if value in (sp.oo, -sp.oo):
                vertical_asymptotes.append(point)

    infinity_values = {}
    if has_negative_infinity:
        infinity_values["-"] = _try_limit(expression, -sp.oo)
    if has_positive_infinity:
        infinity_values["+"] = _try_limit(expression, sp.oo)
    for direction in ("-", "+"):
        if direction not in infinity_values:
            continue
        value = infinity_values[direction]
        label = "x -> %s" % ("-inf" if direction == "-" else "+inf")
        if value is None:
            limit_texts.append(label + ": non calcolabile")
            continue
        limit_texts.append(label + ": " + _limit_value_text(value))
        limit_latexes.append(
            r"\lim_{x \to %s} f(x) = %s"
            % ("-\infty" if direction == "-" else "+\infty", _latex(value)))

    if limit_texts:
        add_section("Limiti", "; ".join(limit_texts), " \\; ".join(limit_latexes))
    else:
        add_section("Limiti", "nessun punto di frontiera da analizzare")

    # --- asintoti ---------------------------------------------------------
    horizontal_asymptotes = []
    oblique_asymptotes = []
    for direction in ("-", "+"):
        value = infinity_values.get(direction)
        if value is None:
            continue
        if _is_finite_number(value):
            horizontal_asymptotes.append((direction, sp.simplify(value)))
        elif value in (sp.oo, -sp.oo):
            point = -sp.oo if direction == "-" else sp.oo
            slope = _try_limit(expression / x, point)
            if slope is not None and _is_finite_number(slope):
                slope = sp.simplify(slope)
                if slope != 0:
                    offset = _try_limit(expression - slope * x, point)
                    if offset is not None and _is_finite_number(offset):
                        oblique_asymptotes.append(
                            (direction, slope, sp.simplify(offset)))

    asymptote_texts = []
    asymptote_latexes = []
    seen_asymptotes = set()
    for point in vertical_asymptotes:
        key = ("v", sp.sstr(point))
        if key in seen_asymptotes:
            continue
        seen_asymptotes.add(key)
        asymptote_texts.append("asintoto verticale: x = " + _display(point))
        asymptote_latexes.append("x = " + _latex(point))
        draw_lines.append("x = " + _ggb_expr(point))
    for _direction, level in horizontal_asymptotes:
        key = ("h", sp.sstr(level))
        if key in seen_asymptotes:
            continue
        seen_asymptotes.add(key)
        asymptote_texts.append("asintoto orizzontale: y = " + _display(level))
        asymptote_latexes.append("y = " + _latex(level))
        draw_lines.append("y = " + _ggb_expr(level))
    for _direction, slope, offset in oblique_asymptotes:
        key = ("o", sp.sstr(slope), sp.sstr(offset))
        if key in seen_asymptotes:
            continue
        seen_asymptotes.add(key)
        asymptote_texts.append("asintoto obliquo: " + _oblique_text(slope, offset))
        asymptote_latexes.append("y = %s x + %s" % (_latex(slope), _latex(offset)))
        draw_lines.append(_ggb_line(slope, offset))
    if asymptote_texts:
        add_section("Asintoti", "; ".join(asymptote_texts),
                    " \\quad ".join(asymptote_latexes))
    else:
        add_section("Asintoti", "nessun asintoto")

    # --- derivate ---------------------------------------------------------
    first_derivative = None
    try:
        first_derivative = sp.simplify(sp.diff(expression, x))
    except Exception:
        try:
            first_derivative = sp.diff(expression, x)
        except Exception:
            first_derivative = None
    if first_derivative is None:
        add_section("Derivata prima", "non calcolabile automaticamente")
    else:
        add_section("Derivata prima",
                    "f'(%s) = %s" % (variable_name, _display(first_derivative)),
                    "f'(%s) = %s" % (variable_name, _latex(first_derivative)))

    second_derivative = None
    try:
        second_derivative = sp.simplify(sp.diff(expression, x, 2))
    except Exception:
        try:
            second_derivative = sp.diff(expression, x, 2)
        except Exception:
            second_derivative = None

    # --- monotonia --------------------------------------------------------
    if first_derivative is not None:
        rising = _sign_set(first_derivative > 0)
        falling = _sign_set(first_derivative < 0)
        if rising is None and falling is None:
            add_section("Monotonia", "non determinata automaticamente")
        else:
            add_section("Monotonia",
                        "f crescente dove f' > 0: %s; "
                        "f decrescente dove f' < 0: %s"
                        % (_sign_text(rising), _sign_text(falling)),
                        ("f' > 0: %s \\quad f' < 0: %s"
                         % (_sign_latex(rising), _sign_latex(falling))).strip())
    else:
        add_section("Monotonia", "non determinata automaticamente")

    # --- massimi e minimi -------------------------------------------------
    stationary = None
    critical_points = []
    if first_derivative is not None:
        try:
            stationary = sp.solveset(first_derivative, x, domain=sp.S.Reals)
        except Exception:
            stationary = None
        if isinstance(stationary, sp.FiniteSet):
            values = list(stationary)
            try:
                values.sort(key=float)
            except Exception:
                pass
            critical_points = values[:20]

    extrema = []
    extrema_latex = []
    for index, point in enumerate(critical_points):
        value = None
        try:
            value = sp.simplify(expression.subs(x, point))
        except Exception:
            value = None
        kind = None
        if second_derivative is not None:
            try:
                second_value = sp.simplify(second_derivative.subs(x, point))
                if second_value.is_negative:
                    kind = "massimo"
                elif second_value.is_positive:
                    kind = "minimo"
            except Exception:
                kind = None
        if kind is None and first_derivative is not None:
            try:
                left = float(first_derivative.subs(x, point - sp.Float("0.001")))
                right = float(first_derivative.subs(x, point + sp.Float("0.001")))
                if left > 0 > right:
                    kind = "massimo"
                elif left < 0 < right:
                    kind = "minimo"
            except Exception:
                kind = None
        if kind is None:
            kind = "punto stazionario"
        if value is not None and _is_finite_number(value):
            extrema.append("%s in (%s, %s)"
                           % (kind, _display(point), _display(value)))
            extrema_latex.append("%s \\text{ in } \\left(%s,\\, %s\\right)"
                                 % (kind, _latex(point), _latex(value)))
            numbers = _numeric_components([point, value])
            if numbers:
                draw_points.append({"nome": "M%d" % (index + 1),
                                    "x": numbers[0], "y": numbers[1],
                                    "tipo": kind})
        else:
            extrema.append("%s in x = %s" % (kind, _display(point)))
            extrema_latex.append("%s \\text{ in } x = %s" % (kind, _latex(point)))
    if first_derivative is None or stationary is None \
            or isinstance(stationary, sp.ConditionSet):
        add_section("Massimi e minimi", "non determinati automaticamente")
    elif not critical_points:
        add_section("Massimi e minimi",
                    "nessun punto stazionario (f' non si annulla)")
    else:
        add_section("Massimi e minimi", "; ".join(extrema),
                    ", \\quad ".join(extrema_latex))

    # --- derivata seconda, concavità e flessi -----------------------------
    if second_derivative is None:
        add_section("Derivata seconda", "non calcolabile automaticamente")
    else:
        add_section("Derivata seconda",
                    "f''(%s) = %s" % (variable_name, _display(second_derivative)),
                    "f''(%s) = %s" % (variable_name, _latex(second_derivative)))

    if second_derivative is not None:
        concave_up = _sign_set(second_derivative > 0)
        concave_down = _sign_set(second_derivative < 0)
        if concave_up is None and concave_down is None:
            add_section("Concavità", "non determinata automaticamente")
        else:
            add_section("Concavità",
                        "concava verso l'alto dove f'' > 0: %s; "
                        "concava verso il basso dove f'' < 0: %s"
                        % (_sign_text(concave_up), _sign_text(concave_down)),
                        ("f'' > 0: %s \\quad f'' < 0: %s"
                         % (_sign_latex(concave_up),
                            _sign_latex(concave_down))).strip())
    else:
        add_section("Concavità", "non determinata automaticamente")

    inflection_points = []
    if second_derivative is not None:
        try:
            candidates = sp.solveset(second_derivative, x, domain=sp.S.Reals)
        except Exception:
            candidates = None
        if isinstance(candidates, sp.FiniteSet):
            values = list(candidates)
            try:
                values.sort(key=float)
            except Exception:
                pass
            for point in values[:20]:
                try:
                    left = float(second_derivative.subs(
                        x, point - sp.Float("0.001")))
                    right = float(second_derivative.subs(
                        x, point + sp.Float("0.001")))
                except Exception:
                    continue
                if (left > 0 > right) or (left < 0 < right):
                    inflection_points.append(point)
    if second_derivative is None:
        add_section("Flessi", "non determinati automaticamente")
    elif not inflection_points:
        add_section("Flessi", "nessun flesso")
    else:
        items = []
        items_latex = []
        for index, point in enumerate(inflection_points):
            value = None
            try:
                value = sp.simplify(expression.subs(x, point))
            except Exception:
                value = None
            if value is not None and _is_finite_number(value):
                items.append("(%s, %s)" % (_display(point), _display(value)))
                items_latex.append("\\left(%s,\\, %s\\right)"
                                   % (_latex(point), _latex(value)))
                numbers = _numeric_components([point, value])
                if numbers:
                    draw_points.append({"nome": "F%d" % (index + 1),
                                        "x": numbers[0], "y": numbers[1],
                                        "tipo": "flesso"})
            else:
                items.append("x = " + _display(point))
                items_latex.append("x = " + _latex(point))
        add_section("Flessi", "flessi in " + ", ".join(items),
                    ", \\quad ".join(items_latex))

    # --- riepilogo e payload di disegno -----------------------------------
    summary = []
    if domain is not None:
        summary.append("dominio " + _set_text(domain))
    if zero_values:
        summary.append("zeri x = "
                       + ", ".join(_display(value) for value in zero_values[:6]))
    elif zero_values == []:
        summary.append("nessuno zero reale")
    if extrema:
        summary.append("; ".join(extrema[:4]))
    if asymptote_texts:
        summary.append("asintoti: " + "; ".join(asymptote_texts[:4]))
    result_text = "studio di %s = %s" % (function_label, expression_text)
    if summary:
        result_text += " -> " + "; ".join(summary)
    if len(result_text) > 400:
        result_text = result_text[:397] + "..."

    draw = {
        "funzione": _ggb_expr(expression),
        "punti": draw_points[:30],
        "linee": draw_lines[:8],
    }
    return {
        "ok": True,
        "kind": "studio",
        "result": result_text,
        "latex": function_label + " = " + _latex(expression),
        "sections": sections,
        "draw": draw,
    }


# ---------- pacchetto: statistica, regressione, complessi, somme parziali, sistemi ----------

def _num_both(value):
    """Testo esatto + approssimazione decimale quando sono diversi (es. 17/5 = 3.4)."""
    text = _display(value)
    try:
        if _is_finite_number(value):
            approx = "%.6g" % float(value)
            if approx != text:
                return text + " = " + approx
    except Exception:
        pass
    return text


def _parse_number_list(raw, parser):
    tokens = [t for t in re.split(r"[;,\s]+", str(raw or "").strip()) if t]
    if not tokens:
        raise UnsafeExpression("servono dei numeri (es. 1, 2, 2, 3, 9)")
    values = []
    for token in tokens:
        value = parser.parse(token)
        if not _is_finite_number(value):
            raise UnsafeExpression("«%s» non è un numero" % token)
        values.append(value)
    return values


def _median_sorted(ordered):
    n = len(ordered)
    if n == 0:
        return None
    if n % 2:
        return ordered[n // 2]
    return sp.nsimplify((ordered[n // 2 - 1] + ordered[n // 2]) / 2)


def _stats_compute(args, parser):
    values = _parse_number_list(args.get("expr"), parser)
    n = len(values)
    total = sp.nsimplify(sp.Add(*values))
    mean = sp.nsimplify(total / n)
    try:
        ordered = sorted(values, key=lambda v: float(v))
    except Exception:
        ordered = list(values)
    median = _median_sorted(ordered)

    counts = {}
    for v in ordered:
        key = sp.sstr(v)
        counts[key] = (counts.get(key, (0, v))[0] + 1, v)
    max_count = max(c for c, _ in counts.values())
    modes = [v for c, v in counts.values() if c == max_count] if max_count > 1 else []

    deviations = [(v - mean) ** 2 for v in values]
    var_pop = sp.nsimplify(sp.Add(*deviations) / n)
    std_pop = sp.sqrt(var_pop)
    var_camp = std_camp = None
    if n > 1:
        var_camp = sp.nsimplify(sp.Add(*deviations) / (n - 1))
        std_camp = sp.sqrt(var_camp)

    lower, upper = ordered[:n // 2], ordered[(n + 1) // 2:]
    q1 = _median_sorted(lower) if lower else None
    q3 = _median_sorted(upper) if upper else None
    iqr = sp.nsimplify(q3 - q1) if (q1 is not None and q3 is not None) else None

    sections = []
    sections.append({"label": "Dati", "text": "n = %d valori: %s" % (n, ", ".join(_display(v) for v in values[:40])),
                     "latex": "n = %d" % n})
    sections.append({"label": "Media", "text": "media = %s" % _num_both(mean), "latex": "\\bar{x} = %s" % _latex(mean)})
    sections.append({"label": "Mediana", "text": "mediana = %s" % _num_both(median), "latex": "\\tilde{x} = %s" % _latex(median)})
    if modes:
        moda_text = ", ".join("%s (compare %d volte)" % (_num_both(v), max_count) for v in modes[:5])
    else:
        moda_text = "nessuna moda (valori tutti diversi)"
    sections.append({"label": "Moda", "text": "moda = " + moda_text, "latex": ""})
    disp = "varianza (popolazione) = %s; dev. standard = %s" % (_num_both(var_pop), _num_both(std_pop))
    if var_camp is not None:
        disp += "\nvarianza (campione) = %s; dev. standard = %s" % (_num_both(var_camp), _num_both(std_camp))
    sections.append({"label": "Dispersione", "text": disp, "latex": "\\sigma = %s" % _latex(std_pop)})
    if q1 is not None and q3 is not None:
        q_text = "Q1 = %s; Q3 = %s; distanza interquartile = %s" % (_num_both(q1), _num_both(q3), _num_both(iqr))
    else:
        q_text = "troppi pochi dati per i quartili"
    sections.append({"label": "Quartili", "text": q_text, "latex": ""})
    sections.append({"label": "Estremi",
                     "text": "minimo = %s; massimo = %s; campo di variazione = %s" % (
                         _num_both(ordered[0]), _num_both(ordered[-1]), _num_both(sp.nsimplify(ordered[-1] - ordered[0]))),
                     "latex": ""})

    result_text = "media = %s, mediana = %s, dev. standard = %s (n = %d)" % (
        _num_both(mean), _num_both(median), _num_both(std_pop), n)
    return {
        "ok": True,
        "kind": "studio",
        "result": result_text[:400],
        "latex": "\\bar{x} = %s" % _latex(mean),
        "sections": sections,
    }


def _regression_compute(args, parser):
    raw = str(args.get("expr") or "").replace("(", " ").replace(")", " ")
    groups = [g.strip() for g in raw.split(";") if g.strip()]
    if len(groups) < 2:
        raise UnsafeExpression("servono almeno due punti nel formato x,y; x,y (es. 1,2; 2,4; 3,5)")
    xs, ys = [], []
    for g in groups:
        parts = [p for p in re.split(r"[,;\s]+", g) if p]
        if len(parts) != 2:
            raise UnsafeExpression("punto non valido: «%s» (usa x,y)" % g)
        x = parser.parse(parts[0])
        y = parser.parse(parts[1])
        if not _is_finite_number(x) or not _is_finite_number(y):
            raise UnsafeExpression("le coordinate devono essere numeri: «%s»" % g)
        xs.append(x)
        ys.append(y)
    n = len(xs)
    sx = sp.nsimplify(sp.Add(*xs))
    sy = sp.nsimplify(sp.Add(*ys))
    sxx = sp.nsimplify(sp.Add(*[x * x for x in xs]))
    sxy = sp.nsimplify(sp.Add(*[x * y for x, y in zip(xs, ys)]))
    syy = sp.nsimplify(sp.Add(*[y * y for y in ys]))
    denom = sp.nsimplify(n * sxx - sx * sx)
    if denom == 0:
        raise UnsafeExpression("tutti i punti hanno la stessa x: la retta di regressione non esiste")
    slope = sp.nsimplify((n * sxy - sx * sy) / denom)
    offset = sp.nsimplify((sy - slope * sx) / n)
    r_num = sp.nsimplify(n * sxy - sx * sy)
    r_den = sp.sqrt(sp.nsimplify(denom * (n * syy - sy * sy)))
    corr = sp.nsimplify(r_num / r_den) if r_den != 0 else None
    r2 = sp.nsimplify(corr * corr) if corr is not None else None

    x = parser.symbols[parser.variable]
    line = slope * x + offset
    if offset.is_number and offset.is_negative:
        line_text = "y = %s·x − %s" % (_num_both(slope), _num_both(-offset))
    else:
        line_text = "y = %s·x + %s" % (_num_both(slope), _num_both(offset))

    sections = [
        {"label": "Punti", "text": ", ".join("(%s, %s)" % (_display(a), _display(b)) for a, b in zip(xs, ys))[:400], "latex": ""},
        {"label": "Retta di regressione", "text": line_text, "latex": "y = %s x + %s" % (_latex(slope), _latex(offset))},
    ]
    if corr is not None:
        sections.append({"label": "Correlazione", "text": "coefficiente r = %s; R² = %s" % (_num_both(corr), _num_both(r2)),
                         "latex": "r = %s" % _latex(corr)})
    else:
        sections.append({"label": "Correlazione", "text": "non calcolabile (dati degeneri)", "latex": ""})

    result_text = line_text
    if corr is not None:
        result_text += " (r = %s, R² = %s)" % (_num_both(corr), _num_both(r2))
    draw = {
        "funzione": _ggb_expr(line),
        "punti": [{"nome": "P%d" % (i + 1), "x": float(a), "y": float(b), "tipo": "dato"}
                  for i, (a, b) in enumerate(zip(xs, ys))],
        "linee": [],
    }
    return {
        "ok": True,
        "kind": "studio",
        "result": result_text[:400],
        "latex": "y = %s x + %s" % (_latex(slope), _latex(offset)),
        "sections": sections,
        "draw": draw,
    }


def _complex_alg_text(label, real_part, imag_part):
    real_text = _num_both(real_part)
    imag_text = _num_both(sp.Abs(imag_part))
    imaginary = imag_part.is_number and imag_part.is_negative
    if imag_part == 0:
        return "%s = %s" % (label, real_text)
    if real_part == 0:
        return "%s = %s%si" % (label, "-" if imaginary else "", imag_text)
    return "%s = %s %s %si" % (label, real_text, "-" if imaginary else "+", imag_text)


def _complex_compute(args, parser):
    raw = args.get("expr")
    if raw is None:
        raise UnsafeExpression("espressione mancante")
    expression = parser.parse(raw)
    free = sorted(str(s) for s in expression.free_symbols)
    if free:
        raise UnsafeExpression("per i numeri complessi usa solo numeri e «i» (trovato: %s)" % ", ".join(free))
    real_part = sp.simplify(sp.re(expression))
    imag_part = sp.simplify(sp.im(expression))
    modulo = sp.simplify(sp.Abs(expression))
    argomento = sp.simplify(sp.arg(expression))
    coniugato = sp.conjugate(expression)

    sections = [
        {"label": "Forma algebrica", "text": _complex_alg_text("z", real_part, imag_part),
         "latex": "z = %s" % _latex(expression)},
    ]
    sections.append({"label": "Modulo", "text": "|z| = %s" % _num_both(modulo), "latex": "|z| = %s" % _latex(modulo)})
    arg_text = "θ = %s rad" % _num_both(argomento)
    try:
        if _is_finite_number(argomento):
            arg_text += " = %.6g°" % (float(argomento) * 180.0 / math.pi)
    except Exception:
        pass
    sections.append({"label": "Argomento", "text": arg_text, "latex": "\\theta = %s" % _latex(argomento)})
    sections.append({"label": "Coniugato", "text": _complex_alg_text("z̄", real_part, -imag_part),
                     "latex": "\\bar{z} = %s" % _latex(coniugato)})
    if _is_finite_number(modulo) and _is_finite_number(argomento):
        angle_text = "%.6g" % float(argomento)
        polar = "z = %s·(cos %s + i·sin %s)" % ("%.6g" % float(modulo), angle_text, angle_text)
    else:
        polar = "z = |z|·(cos θ + i·sin θ) con |z| = %s, θ = %s" % (_display(modulo), _display(argomento))
    sections.append({"label": "Forma polare", "text": polar, "latex": "z = %s\\left(\\cos\\theta + i\\sin\\theta\\right)" % _latex(modulo)})

    result_text = _complex_alg_text("z", real_part, imag_part) + "; |z| = " + _num_both(modulo)
    draw = None
    if _is_finite_number(real_part) and _is_finite_number(imag_part):
        re_f, im_f = float(real_part), float(imag_part)
        draw = {
            "punti": [
                {"nome": "Z", "x": re_f, "y": im_f, "tipo": "complesso"},
                {"nome": "zC", "x": re_f, "y": -im_f, "tipo": "coniugato"},
            ],
            "segmenti": [
                {"da": [0, 0], "a": [re_f, im_f], "tipo": "complesso"},
                {"da": [0, 0], "a": [re_f, -im_f], "tipo": "coniugato"},
            ],
            "linee": [],
        }
    payload = {
        "ok": True,
        "kind": "studio",
        "result": result_text[:400],
        "latex": "z = %s" % _latex(expression),
        "sections": sections,
    }
    if draw is not None:
        payload["draw"] = draw
    return payload


def _partial_sums_compute(args, parser):
    raw = args.get("expr")
    if raw is None:
        raise UnsafeExpression("espressione mancante")
    expression = parser.parse(raw)
    variable = parser.symbols[parser.variable]
    variable_name = parser.variable
    order = _int_option(args.get("order"), 10, "quante somme", 1, 100)
    partials = []
    for k in range(1, order + 1):
        partials.append(sp.simplify(sp.summation(expression, (variable, 1, k))))
    limit = None
    try:
        limit = sp.simplify(sp.summation(expression, (variable, 1, sp.oo)))
    except Exception:
        limit = None

    shown = partials[:20]
    par_text = ", ".join("S%d = %s" % (i + 1, _num_both(v)) for i, v in enumerate(shown))
    if len(partials) > 20:
        par_text += ", …"
    sections = [
        {"label": "Termine generale", "text": "a_%s = %s" % (variable_name, _display(expression)),
         "latex": "a_{%s} = %s" % (variable_name, _latex(expression))},
        {"label": "Somme parziali", "text": par_text[:600],
         "latex": ", \\; ".join("S_{%d} = %s" % (i + 1, _latex(v)) for i, v in enumerate(shown))[:800]},
    ]
    diverges = limit is None or limit in (sp.oo, -sp.oo, sp.zoo, sp.nan)
    if diverges:
        lim_text = "non converge (o forma chiusa non trovata)" if limit is None or limit in (sp.zoo, sp.nan) else "la serie diverge (%s)" % _display(limit)
    else:
        lim_text = "somma della serie = %s" % _num_both(limit)
    sections.append({"label": "Somma della serie", "text": lim_text, "latex": ("" if diverges else "\\sum_{%s=1}^{\\infty} a_{%s} = %s" % (variable_name, variable_name, _latex(limit)))})

    result_text = "S_%d = %s" % (order, _display(partials[-1]))
    if not diverges:
        result_text += "; somma della serie = %s" % _num_both(limit)
    else:
        result_text += "; la serie non converge"
    draw_points = []
    for i, v in enumerate(partials):
        if _is_finite_number(v):
            draw_points.append({"nome": "S%d" % (i + 1), "x": i + 1, "y": float(v), "tipo": "somma_parziale"})
    payload = {
        "ok": True,
        "kind": "studio",
        "result": result_text[:400],
        "latex": "S_{%d} = %s" % (order, _latex(partials[-1])),
        "sections": sections,
    }
    if draw_points:
        payload["draw"] = {"punti": draw_points[:40], "linee": []}
    return payload


def _system_compute(args, parser):
    raw = str(args.get("expr") or "")
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    if len(parts) < 2:
        raise UnsafeExpression("scrivi due equazioni separate da «;» (es. x+y=3; x-y=1)")
    if len(parts) > 4:
        raise UnsafeExpression("al massimo 4 equazioni")
    equations = []
    symbols = {}
    for p in parts:
        if "=" not in p:
            raise UnsafeExpression("«%s» non è un'equazione (manca =)" % p)
        expression = parser.parse(p)
        equations.append(sp.Eq(expression, 0))
        for symbol in expression.free_symbols:
            symbols[str(symbol)] = symbol
    if not symbols:
        raise UnsafeExpression("nessuna incognita nelle equazioni")
    names = sorted(symbols.keys())
    variables = [symbols[name] for name in names]
    try:
        solution = sp.solve(equations, variables, dict=True)
    except Exception as exc:
        raise UnsafeExpression("risoluzione non riuscita: %s" % exc)

    sections = [{"label": "Equazioni", "text": "; ".join(parts)[:400], "latex": ""}]
    if not solution:
        sol_text = "nessuna soluzione"
        sol_latex = "\\varnothing"
    else:
        pieces, pieces_latex = [], []
        for sol in solution[:6]:
            row = []
            for name in names:
                value = sol.get(symbols[name])
                row.append(name + " = " + (_num_both(value) if value is not None else "libera"))
            pieces.append(", ".join(row))
            pieces_latex.append(",\\; ".join(
                "%s = %s" % (name, _latex(sol[symbols[name]]))
                for name in names if sol.get(symbols[name]) is not None) or "infinite soluzioni")
        sol_text = "; ".join(pieces)
        sol_latex = ";\\quad ".join(pieces_latex)
    sections.append({"label": "Soluzione", "text": sol_text[:400], "latex": sol_latex})

    payload = {
        "ok": True,
        "kind": "studio",
        "result": sol_text[:400],
        "latex": sol_latex[:400],
        "sections": sections,
    }

    # disegno: solo per due equazioni in x e y, entrambe risolvibili come y = m x + q
    x_sym, y_sym = symbols.get("x"), symbols.get("y")
    if x_sym is not None and y_sym is not None and len(parts) == 2:
        funzioni = []
        for idx, eq in enumerate(equations):
            try:
                solved = sp.solve(eq, y_sym)
            except Exception:
                solved = []
            if len(solved) != 1:
                funzioni = []
                break
            expr_y = sp.simplify(solved[0])
            if not isinstance(expr_y, sp.Basic) or expr_y.has(y_sym):
                funzioni = []
                break
            try:
                if sp.Poly(expr_y, x_sym).degree() > 1:
                    funzioni = []
                    break
            except Exception:
                funzioni = []
                break
            funzioni.append({"nome": "f" if idx == 0 else "g", "espressione": _ggb_expr(expr_y)})
        if len(funzioni) == 2:
            draw = {"funzioni": funzioni, "punti": [], "linee": []}
            if solution:
                first = solution[0]
                xv, yv = first.get(x_sym), first.get(y_sym)
                if xv is not None and yv is not None and _is_finite_number(xv) and _is_finite_number(yv):
                    draw["punti"].append({"nome": "S", "x": float(xv), "y": float(yv), "tipo": "soluzione"})
            payload["draw"] = draw
    return payload


def _display(value):
    try:
        return sp.sstr(value)
    except Exception:
        return str(value)


def _latex(value):
    try:
        return sp.latex(value)
    except Exception:
        return _display(value)


def compute(args):
    try:
        if not isinstance(args, dict):
            raise UnsafeExpression("richiesta non valida")
        operation = args.get("operation")
        if operation not in OPERATIONS:
            raise UnsafeExpression("operazione non supportata")

        variable_name = args.get("var") or ("n" if operation == "parziali" else "x")
        if not _valid_identifier(variable_name):
            raise UnsafeExpression("variabile non valida")
        parser = SafeMathParser(variable_name)

        if operation in VECTOR_OPERATIONS:
            return _vector_operation(operation, args, parser)
        if operation == "studio":
            return _studio_compute(args, parser)
        if operation == "stats":
            return _stats_compute(args, parser)
        if operation == "regressione":
            return _regression_compute(args, parser)
        if operation == "complesso":
            return _complex_compute(args, parser)
        if operation == "parziali":
            return _partial_sums_compute(args, parser)
        if operation == "sistema":
            return _system_compute(args, parser)

        if operation in {"det", "inverse", "transpose", "eigenvals", "eigenvects", "rank", "rref"}:
            raw_matrix = args.get("matrix")
            if raw_matrix is None:
                raw_matrix = args.get("expr")
            matrix_value = parser.parse(raw_matrix)
            matrix = _matrix_from(matrix_value)
            if operation == "det":
                result = matrix.det()
            elif operation == "inverse":
                result = matrix.inv()
            elif operation == "transpose":
                result = matrix.T
            elif operation == "eigenvals":
                result = matrix.eigenvals()
            elif operation == "eigenvects":
                result = matrix.eigenvects()
            elif operation == "rank":
                result = matrix.rank()
            else:
                result = matrix.rref()
        else:
            raw_expr = args.get("expr")
            if raw_expr is None:
                raise UnsafeExpression("espressione mancante")
            expression = parser.parse(raw_expr)
            variable = parser.symbols[variable_name]

            if operation == "simplify":
                result = sp.simplify(expression)
            elif operation == "diff":
                order = _int_option(args.get("order"), 1, "ordine", 0, 20)
                result = sp.diff(expression, variable, order)
            elif operation == "integrate":
                if args.get("lower") is not None and args.get("upper") is not None:
                    lower = parser.parse(str(args["lower"]))
                    upper = parser.parse(str(args["upper"]))
                    result = sp.integrate(expression, (variable, lower, upper))
                else:
                    result = sp.integrate(expression, variable)
            elif operation == "limit":
                point = parser.parse(str(args.get("point", "0")))
                direction = args.get("dir", "+-")
                if direction not in ("+", "-", "+-"):
                    raise UnsafeExpression("direzione del limite non valida")
                result = sp.limit(expression, variable, point, dir=direction)
            elif operation == "series":
                point = parser.parse(str(args.get("point", "0")))
                order = _int_option(args.get("order"), 6, "ordine", 1, MAX_SERIES_ORDER)
                result = sp.series(expression, variable, point, order)
            elif operation == "expand":
                result = sp.expand(expression)
            elif operation == "factor":
                result = sp.factor(expression)
            elif operation == "apart":
                result = sp.apart(expression, variable)
            elif operation == "together":
                result = sp.together(expression)
            elif operation == "solve":
                solve_for = args.get("solve_for") or variable_name
                if not _valid_identifier(solve_for):
                    raise UnsafeExpression("solve_for non valida")
                symbol = parser.symbols.get(solve_for, sp.Symbol(solve_for))
                result = sp.solve(expression, symbol)
            elif operation == "dsolve":
                function_name = args.get("func") or "y"
                if not _valid_identifier(function_name):
                    raise UnsafeExpression("funzione incognita non valida")
                function = parser.undefined_functions.get(function_name)
                if function is None:
                    function = sp.Function(function_name)
                result = sp.dsolve(expression, function(variable))
            elif operation == "evaluate":
                substitutions = args.get("subs") or {}
                if not isinstance(substitutions, dict):
                    raise UnsafeExpression("subs deve essere un oggetto")
                parsed_substitutions = {}
                for name, value in substitutions.items():
                    if not _valid_identifier(name):
                        raise UnsafeExpression("nome in subs non valido")
                    symbol = parser.symbols.get(name, sp.Symbol(name))
                    parsed_substitutions[symbol] = parser.parse(str(value))
                result = expression.subs(parsed_substitutions) if parsed_substitutions else expression
            elif operation == "latex":
                result = _latex(expression)
            else:
                raise UnsafeExpression("operazione non supportata")

        latex_result = result if operation == "latex" else _latex(result)
        return {"ok": True, "result": _display(result), "latex": latex_result}
    except Exception as exc:
        message = str(exc).strip() or exc.__class__.__name__
        return {"ok": False, "error": message[:500]}


def main():
    try:
        if len(sys.argv) > 1:
            args = json.loads(sys.argv[1])
        else:
            args = json.load(sys.stdin)
        output = compute(args)
    except Exception as exc:
        output = {"ok": False, "error": (str(exc).strip() or "richiesta non valida")[:500]}
    text = json.dumps(output, ensure_ascii=False, separators=(",", ":"))
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    try:
        text.encode(encoding)
    except (UnicodeEncodeError, LookupError):
        text = json.dumps(output, ensure_ascii=True, separators=(",", ":"))
    sys.stdout.write(text)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
