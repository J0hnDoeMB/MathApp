"""Regression tests for MathApp's command-line SymPy boundary."""

import json
import subprocess
import sys
import unittest
from pathlib import Path


CLI = Path(__file__).with_name("sympy_cli.py")


def compute(payload):
    completed = subprocess.run(
        [sys.executable, str(CLI), json.dumps(payload)],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if completed.returncode != 0:
        raise AssertionError(
            f"sympy_cli exited {completed.returncode}: {completed.stderr.strip()}"
        )
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise AssertionError(
            f"sympy_cli returned invalid JSON: {completed.stdout!r}; "
            f"stderr={completed.stderr!r}"
        ) from exc


class SympyCliTests(unittest.TestCase):
    def test_factors_polynomial_with_caret_power(self):
        result = compute({"operation": "factor", "expr": "x^2-9"})
        self.assertTrue(result.get("ok"), result)
        self.assertIn("x", result.get("result", ""))
        self.assertIn("3", result.get("result", ""))

    def test_integrates_trigonometric_expression_and_returns_latex(self):
        result = compute({"operation": "integrate", "expr": "sin(x)^2", "var": "x"})
        self.assertTrue(result.get("ok"), result)
        self.assertTrue(result.get("latex"), result)
        self.assertIn("x", result["latex"])

    def test_evaluates_set_union_used_by_the_tutor(self):
        result = compute({"operation": "evaluate", "expr": "{1,2,3} | {2,3,4}"})
        self.assertTrue(result.get("ok"), result)
        for value in ("1", "2", "3", "4"):
            self.assertIn(value, result.get("result", ""))

    def test_latex_and_substitution_operations(self):
        latex = compute({"operation": "latex", "expr": "x^2"})
        self.assertTrue(latex.get("ok"), latex)
        self.assertIn("x^{2}", latex.get("result", ""))

        evaluated = compute({
            "operation": "evaluate",
            "expr": "x^2+1",
            "subs": {"x": "3"},
        })
        self.assertTrue(evaluated.get("ok"), evaluated)
        self.assertEqual(evaluated.get("result"), "10")

    def test_python_introspection_expression_is_rejected(self):
        payload = (
            'sympify.__globals__["__builtins__"]["__import__"]'
            '("os").getcwd()'
        )
        result = compute({"operation": "latex", "expr": payload})
        self.assertFalse(result.get("ok"), result)
        self.assertTrue(result.get("error"), result)
        self.assertNotIn("result", result)

    def test_rejects_python_attribute_indexing_and_lambda_syntax(self):
        unsafe = (
            "x.__class__",
            "x[0]",
            "(lambda: 1)()",
        )
        for expression in unsafe:
            with self.subTest(expression=expression):
                result = compute({"operation": "simplify", "expr": expression})
                self.assertFalse(result.get("ok"), result)
                self.assertTrue(result.get("error"), result)

    def test_limits_nested_symbolic_powers_before_expansion(self):
        result = compute({
            "operation": "latex",
            "expr": "((x+1)^1000)^1000",
        })
        self.assertFalse(result.get("ok"), result)
        self.assertIn("limite", result.get("error", "").lower())

    def test_limits_gamma_factorial_sized_results(self):
        result = compute({"operation": "evaluate", "expr": "gamma(1001)"})
        self.assertFalse(result.get("ok"), result)
        self.assertIn("limite", result.get("error", "").lower())

    def test_equation_solving_implicit_multiplication_and_matrix(self):
        solved = compute({"operation": "solve", "expr": "x^2-3x+2=0"})
        self.assertTrue(solved.get("ok"), solved)
        self.assertIn("1", solved.get("result", ""))
        self.assertIn("2", solved.get("result", ""))

        determinant = compute({"operation": "det", "matrix": "[[1,2],[3,4]]"})
        self.assertTrue(determinant.get("ok"), determinant)
        self.assertEqual(determinant.get("result"), "-2")

    def test_calculus_and_differential_equation_operations(self):
        derivative = compute({"operation": "diff", "expr": "sin(x)^2"})
        self.assertTrue(derivative.get("ok"), derivative)
        self.assertTrue(derivative.get("result"), derivative)

        limit = compute({"operation": "limit", "expr": "sin(x)/x", "point": "0"})
        self.assertTrue(limit.get("ok"), limit)
        self.assertEqual(limit.get("result"), "1")

        solution = compute({
            "operation": "dsolve",
            "expr": "Derivative(y(x),x)-y(x)=0",
        })
        self.assertTrue(solution.get("ok"), solution)
        self.assertIn("exp(x)", solution.get("result", ""))

    def test_series_and_matrix_operations(self):
        series = compute({"operation": "series", "expr": "exp(x)", "order": 4})
        self.assertTrue(series.get("ok"), series)
        self.assertIn("O(x**4)", series.get("result", ""))

        for operation in ("inverse", "transpose", "eigenvals", "eigenvects", "rank", "rref"):
            with self.subTest(operation=operation):
                result = compute({"operation": operation, "matrix": "[[1,2],[3,4]]"})
                self.assertTrue(result.get("ok"), result)
                self.assertIn("result", result)

    def test_studio_polynomial_reports_domain_zeros_extrema(self):
        result = compute({"operation": "studio", "expr": "x^2-3x+2"})
        self.assertTrue(result.get("ok"), result)
        self.assertEqual(result.get("kind"), "studio")
        labels = [section["label"] for section in result.get("sections", [])]
        for label in ("Funzione", "Dominio", "Zeri (asse x)", "Segno", "Limiti",
                      "Asintoti", "Derivata prima", "Monotonia",
                      "Massimi e minimi", "Derivata seconda", "Concavità", "Flessi"):
            self.assertIn(label, labels)
        zero_section = next(s for s in result["sections"]
                            if s["label"] == "Zeri (asse x)")
        self.assertIn("1", zero_section["text"])
        self.assertIn("2", zero_section["text"])
        extrema = next(s for s in result["sections"]
                       if s["label"] == "Massimi e minimi")
        self.assertIn("minimo", extrema["text"])
        self.assertIn("3/2", extrema["text"])
        draw = result.get("draw", {})
        self.assertIn("x^2", draw.get("funzione", ""))
        names = [point["nome"] for point in draw.get("punti", [])]
        self.assertIn("Z1", names)
        self.assertIn("M1", names)

    def test_studio_rational_function_finds_asymptotes(self):
        result = compute({"operation": "studio", "expr": "x/(x^2-1)"})
        self.assertTrue(result.get("ok"), result)
        asymptotes = next(s for s in result["sections"]
                          if s["label"] == "Asintoti")
        self.assertIn("x = -1", asymptotes["text"])
        self.assertIn("x = 1", asymptotes["text"])
        self.assertIn("y = 0", asymptotes["text"])
        domin = next(s for s in result["sections"] if s["label"] == "Dominio")
        self.assertIn("-1", domin["text"])
        self.assertEqual(result["draw"]["linee"], ["x = -1", "x = 1", "y = 0"])
        flessi = next(s for s in result["sections"] if s["label"] == "Flessi")
        self.assertIn("(0, 0)", flessi["text"])

    def test_studio_accepts_f_of_x_prefix_and_logarithm(self):
        result = compute({"operation": "studio", "expr": "f(x)=ln(x)"})
        self.assertTrue(result.get("ok"), result)
        domin = next(s for s in result["sections"] if s["label"] == "Dominio")
        self.assertIn("0", domin["text"])
        self.assertIn("+inf", domin["text"])
        zeros = next(s for s in result["sections"] if s["label"] == "Zeri (asse x)")
        self.assertIn("x = 1", zeros["text"])
        monotonia = next(s for s in result["sections"]
                         if s["label"] == "Monotonia")
        self.assertIn("mai nel dominio", monotonia["text"])

    def test_studio_oblique_asymptote_and_rejects_bad_input(self):
        result = compute({"operation": "studio", "expr": "x^2/(x-1)"})
        self.assertTrue(result.get("ok"), result)
        asymptotes = next(s for s in result["sections"]
                          if s["label"] == "Asintoti")
        self.assertIn("x = 1", asymptotes["text"])
        self.assertIn("obliquo", asymptotes["text"])
        self.assertIn("y = x + 1", result["draw"]["linee"][-1])

        missing = compute({"operation": "studio"})
        self.assertFalse(missing.get("ok"), missing)
        unsafe = compute({"operation": "studio", "expr": "x.__class__"})
        self.assertFalse(unsafe.get("ok"), unsafe)
        unsafe_call = compute({"operation": "studio", "expr": "x[0]"})
        self.assertFalse(unsafe_call.get("ok"), unsafe_call)

    def test_vector_operations_basic(self):
        dot = compute({"operation": "dot", "vectors": "[[1,2,3],[4,5,6]]"})
        self.assertTrue(dot.get("ok"), dot)
        self.assertEqual(dot.get("kind"), "vettori")
        self.assertIn("32", dot.get("result", ""))
        self.assertEqual(dot["draw"]["dimension"], 3)

        direct = compute({"operation": "dot", "vectors": [[1, 2], [3, 4]]})
        self.assertTrue(direct.get("ok"), direct)
        self.assertIn("11", direct.get("result", ""))

        cross = compute({"operation": "cross", "vectors": "[[1,2,3],[4,5,6]]"})
        self.assertTrue(cross.get("ok"), cross)
        self.assertIn("(-3, 6, -3)", cross.get("result", ""))

        norm = compute({"operation": "norm", "vectors": "[[3,4]]"})
        self.assertTrue(norm.get("ok"), norm)
        self.assertIn("|v1| = 5", norm.get("result", ""))

    def test_vector_angle_projection_and_draw_payload(self):
        angle = compute({"operation": "angle", "vectors": "[[1,0],[0,1]]"})
        self.assertTrue(angle.get("ok"), angle)
        self.assertIn("pi/2", angle.get("result", ""))
        self.assertIn("90", angle.get("note", ""))

        projection = compute({"operation": "projection", "vectors": "[[3,4],[1,0]]"})
        self.assertTrue(projection.get("ok"), projection)
        self.assertIn("(3, 0)", projection.get("result", ""))
        self.assertIn("3", projection.get("note", ""))
        draw = projection.get("draw", {})
        self.assertEqual(draw.get("dimension"), 2)
        labels = [vector["label"] for vector in draw.get("vettori", [])]
        self.assertIn("proiezione", labels)

    def test_vector_independence_and_gram_schmidt(self):
        dependent = compute({
            "operation": "independence",
            "vectors": "[[1,0],[0,1],[1,1]]",
        })
        self.assertTrue(dependent.get("ok"), dependent)
        self.assertIn("dipendenti", dependent.get("result", ""))
        self.assertIn("v3 = v1 + v2", dependent.get("note", ""))

        independent = compute({
            "operation": "independence",
            "vectors": "[[1,0],[0,1]]",
        })
        self.assertTrue(independent.get("ok"), independent)
        self.assertIn("indipendenti", independent.get("result", ""))
        self.assertIn("base", independent.get("note", ""))

        gram = compute({"operation": "gram_schmidt", "vectors": "[[1,1],[1,0]]"})
        self.assertTrue(gram.get("ok"), gram)
        self.assertIn("q1", gram.get("result", ""))
        self.assertIn("ortonormale", gram.get("note", ""))

        dependent_gram = compute({
            "operation": "gram_schmidt",
            "vectors": "[[1,0],[2,0]]",
        })
        self.assertFalse(dependent_gram.get("ok"), dependent_gram)

    def test_vector_operation_errors_are_reported(self):
        mismatched = compute({"operation": "dot", "vectors": "[[1,2],[1,2,3]]"})
        self.assertFalse(mismatched.get("ok"), mismatched)
        wrong_cross = compute({"operation": "cross", "vectors": "[[1,2],[3,4]]"})
        self.assertFalse(wrong_cross.get("ok"), wrong_cross)
        symbolic = compute({"operation": "dot", "vectors": "[[a,2],[1,2]]"})
        self.assertFalse(symbolic.get("ok"), symbolic)
        zero_angle = compute({"operation": "angle", "vectors": "[[0,0],[1,0]]"})
        self.assertFalse(zero_angle.get("ok"), zero_angle)
        single_dot = compute({"operation": "dot", "vectors": "[[1,2]]"})
        self.assertFalse(single_dot.get("ok"), single_dot)

    # ---------- statistica, regressione, complessi, somme parziali, sistemi ----------

    def test_stats_describes_number_list(self):
        result = compute({"operation": "stats", "expr": "1, 2, 2, 3, 9"})
        self.assertTrue(result.get("ok"), result)
        self.assertEqual(result.get("kind"), "studio")
        text = " ".join(s.get("text", "") for s in result.get("sections", []))
        self.assertIn("media = 17/5 = 3.4", text)
        self.assertIn("mediana = 2", text)
        self.assertIn("moda = 2 (compare 2 volte)", text)
        self.assertIn("Q3 = 6", text)

    def test_stats_rejects_non_numbers(self):
        result = compute({"operation": "stats", "expr": "1, x, 3"})
        self.assertFalse(result.get("ok"), result)
        empty = compute({"operation": "stats", "expr": ""})
        self.assertFalse(empty.get("ok"), empty)

    def test_regression_fits_line_and_correlation(self):
        result = compute({"operation": "regressione", "expr": "1,2; 2,4; 3,5; 4,6"})
        self.assertTrue(result.get("ok"), result)
        draw = result.get("draw", {})
        self.assertEqual(len(draw.get("punti", [])), 4)
        self.assertIn("x", draw.get("funzione", ""))
        text = " ".join(s.get("text", "") for s in result.get("sections", []))
        self.assertIn("13/10", text)  # pendenza esatta 1.3
        self.assertIn("R²", text)

    def test_regression_rejects_degenerate_and_malformed(self):
        same_x = compute({"operation": "regressione", "expr": "1,2; 1,3"})
        self.assertFalse(same_x.get("ok"), same_x)
        malformed = compute({"operation": "regressione", "expr": "1,2,3; 2,4"})
        self.assertFalse(malformed.get("ok"), malformed)
        single = compute({"operation": "regressione", "expr": "1,2"})
        self.assertFalse(single.get("ok"), single)

    def test_complex_numbers_algebraic_polar_and_draw(self):
        result = compute({"operation": "complesso", "expr": "3+4i"})
        self.assertTrue(result.get("ok"), result)
        text = " ".join(s.get("text", "") for s in result.get("sections", []))
        self.assertIn("z = 3 + 4i", text)
        self.assertIn("|z| = 5", text)
        self.assertIn("53.1301°", text)
        self.assertIn("z̄ = 3 - 4i", text)
        draw = result.get("draw", {})
        self.assertEqual(len(draw.get("segmenti", [])), 2)
        names = [p["nome"] for p in draw.get("punti", [])]
        self.assertIn("Z", names)   # "z" da solo è riservato in GeoGebra (asse z)
        self.assertIn("zC", names)

        quotient = compute({"operation": "complesso", "expr": "(3+4i)/(1-2i)"})
        self.assertTrue(quotient.get("ok"), quotient)
        self.assertIn("-1 + 2i", quotient.get("result", ""))

    def test_complex_rejects_other_variables(self):
        result = compute({"operation": "complesso", "expr": "x+2i"})
        self.assertFalse(result.get("ok"), result)

    def test_partial_sums_geometric_and_p_series(self):
        result = compute({"operation": "parziali", "expr": "1/2^n", "order": 5})
        self.assertTrue(result.get("ok"), result)
        text = " ".join(s.get("text", "") for s in result.get("sections", []))
        self.assertIn("S5 = 31/32", text)
        self.assertIn("somma della serie = 1", text)

        p_series = compute({"operation": "parziali", "expr": "1/n^2", "order": 3})
        self.assertTrue(p_series.get("ok"), p_series)
        draw = p_series.get("draw", {})
        self.assertEqual(len(draw.get("punti", [])), 3)

    def test_partial_sums_divergent_series(self):
        result = compute({"operation": "parziali", "expr": "1/n", "order": 4})
        self.assertTrue(result.get("ok"), result)
        self.assertIn("non converge", result.get("result", ""))

    def test_system_solves_and_prepares_drawing(self):
        result = compute({"operation": "sistema", "expr": "x+y=3; x-y=1"})
        self.assertTrue(result.get("ok"), result)
        self.assertEqual(result.get("result"), "x = 2, y = 1")
        draw = result.get("draw", {})
        self.assertEqual(len(draw.get("funzioni", [])), 2)
        self.assertEqual(draw.get("punti", [{}])[0].get("nome"), "S")

    def test_system_errors(self):
        single = compute({"operation": "sistema", "expr": "x+y=3"})
        self.assertFalse(single.get("ok"), single)
        no_equals = compute({"operation": "sistema", "expr": "x+y; x-y=1"})
        self.assertFalse(no_equals.get("ok"), no_equals)
        impossible = compute({"operation": "sistema", "expr": "x+y=1; x+y=2"})
        self.assertTrue(impossible.get("ok"), impossible)
        self.assertIn("nessuna soluzione", impossible.get("result", ""))


if __name__ == "__main__":
    unittest.main()
