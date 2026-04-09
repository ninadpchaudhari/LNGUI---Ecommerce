---
marp: true
theme: default
class: lead
paginate: true
backgroundColor: #ffffff
---

# Research Update: Testing Language-Mediated GUIs
## From Theoretical Fault Models to Empirical Validation

**Presenters:** Chaudhari, Ninad & Kuri, Sharmista

---
# Quick Recap: The Challenge

- **The Problem:** Language-Mediated GUIs (LNGUIs) suffer from non-determinism, context sensitivity, and complex failure modalities.
- **Why Traditional Testing Fails:** We cannot possibly test every permutation of a natural language command (E2E testing is insufficient).
- **Our Approach (Metamorphic Testing):** Instead of checking for one hardcoded "correct" output, we test if the system preserves expected mathematical relationships when inputs are transformed.

---

# Formalizing Semantic Equivalence

**Metamorphic Relation - Semantic Equivalence ($MR_{SE}$):** Semantically equivalent utterances under identical conditions must activate identical controls.

**Formal Definition:**
$MR_{SE}: \forall \sigma, \forall u_1, u_2 \in \mathcal{U}. Syn(u_1, u_2) \implies \mathcal{O}(\sigma \xrightarrow{u_1} \sigma') = \mathcal{O}(\sigma \xrightarrow{u_2} \sigma'')$

**In Practice:**
If user input $u_1$ and $u_2$ mean the exact same thing, the resulting UI state must be strictly equal.

---

# Empirical Update: Finding Faults in the Wild

**System Under Test (SUT):** Live chat-assisted e-commerce app (Vercel)

**The Test:** Applying a simple case-variance transformation to test $MR_{SE}$ (e.g., "show shoes" vs. "SHOW SHOES").

**The Result:** ❌ **Fail.** The application activates different controls based on capitalization.

*(Insert Screenshots Here: Lowercase prompt vs. Uppercase prompt from your Vercel app)*

---

# Mapping the Finding to our Taxonomy

This bug is a direct, empirical manifestation of **Synonym Blindness** (specifically syntactic/case blindness).

**Why this matters:**
- It proves that basic, deterministic natural language transformations can break the LLM-to-UI mediator layer.
- If the system fails on basic capitalization, it will inevitably fail on complex paraphrasing.
- **Conclusion:** Our hypothesis is validated—LNGUIs require specialized testing methodologies.

---

# Next Step: The Automation Pipeline

Now that we have a manually verified fault, we are automating the execution loop defined in our specification.

1. **The Generator ($\mathcal{G}$):** Scripting automated utterance pairs $(u, u')$ using simple perturbations and paraphrase models.
2. **The Harness:**
   - `RESETAPP(A)` to state $\sigma_0$
   - Inject $u_1 \rightarrow$ Capture observation $O_1$
   - `RESETAPP(A)` to state $\sigma_0$
   - Inject $u_2 \rightarrow$ Capture observation $O_2$
   - Assert `CHECK(MR, O1, O2)`

---

# Updated Research Roadmap

- **Phase 1 (Completed):** Define formal mathematical model, taxonomy, and relations.
- **Phase 2 (Current):** Manual validation and identification of isolated faults (Case Invariance found!).
- **Phase 3 (Next 2-4 Weeks):** Scripting the Automated Metamorphic Test harness.
- **Phase 4 (Future):** Expanding the test suite to evaluate $MR_{CA}$ (Action Sequence Permutation) and $MR_{REV}$ (State Restoration).

---
class: lead
# Questions & Discussion